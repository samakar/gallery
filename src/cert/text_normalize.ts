// text_normalize.ts
// Unicode normalization + abuse mitigation for the three free-form Unicode
// fields persisted in Image.title, Image.description, Creator.display_name.
// Per docs/registry/deed.md §6 OI-13. Applied at persistence time (before
// writing to local DB / before Arweave JSON upload at mint).
//
// Each public normalizer returns { ok: true, value } on success or
// { ok: false, code, message } on rejection, so callers can map to HTTP 400 /
// 409 without throwing across the request boundary.
//
// Output guarantees for accepted values:
//   - NFC-normalized
//   - No BiDi override / isolate characters (U+202A-202E, U+2066-2069)
//   - No filename / Content-Disposition-breaking CR or LF in title / display_name
//   - Code-point length within configured bounds
//
// Content-Disposition filename sanitization for OI-14 (a) lives in this file
// because it is the same "make a Unicode string safe at a boundary" concern.

export type NormalizeOk = { ok: true; value: string };
export type NormalizeErr = { ok: false; code: string; message: string };
export type NormalizeResult = NormalizeOk | NormalizeErr;

// Code-point length (NOT UTF-16 .length); a single astral emoji is one code
// point, not two. Matches the schema's "code-point counting" rule in deed.md.
function codePointLength(s: string): number {
    let n = 0;
    for (const _ of s) n++;
    return n;
}

// C0 control range: U+0000-U+001F. C1 control range: U+0080-U+009F.
// Tab (U+0009) and LF (U+000A) carved out only where the caller opts in.
function stripControls(s: string, allowTabLf: boolean): string {
    let out = '';
    for (const ch of s) {
        const cp = ch.codePointAt(0)!;
        const isC0 = cp <= 0x001f;
        const isC1 = cp >= 0x0080 && cp <= 0x009f;
        if (isC0 || isC1) {
            if (allowTabLf && (cp === 0x09 || cp === 0x0a)) {
                out += ch;
            }
            // else drop
            continue;
        }
        out += ch;
    }
    return out;
}

// Zero-width characters that are abused for spoofing and invisible payloads:
// ZWSP (U+200B), ZWNJ (U+200C), ZWJ (U+200D), WORD JOINER (U+2060),
// BOM (U+FEFF). Stripped unconditionally in title / display_name; count-capped
// in description. Class is built via String.fromCharCode so the source file
// stays free of invisible characters.
const ZERO_WIDTH = new RegExp(
    '[' + String.fromCharCode(0x200b, 0x200c, 0x200d, 0x2060, 0xfeff) + ']',
    'g',
);
const ZERO_WIDTH_DESC_MAX_PER_100 = 5;

function stripZeroWidth(s: string): string {
    return s.replace(ZERO_WIDTH, '');
}

function countZeroWidth(s: string): number {
    const m = s.match(ZERO_WIDTH);
    return m ? m.length : 0;
}

// BiDi override / isolate characters that can flip rendered direction and
// spoof filename-style attacks on identifier-shaped strings. Rejected
// outright (not stripped) because if they are present the input is almost
// certainly an attack: legitimate creators don't reach for U+202E.
//   LRE U+202A, RLE U+202B, PDF U+202C, LRO U+202D, RLO U+202E
//   LRI U+2066, RLI U+2067, FSI U+2068, PDI U+2069
const BIDI_OVERRIDE = new RegExp(
    '['
    + String.fromCharCode(0x202a) + '-' + String.fromCharCode(0x202e)
    + String.fromCharCode(0x2066) + '-' + String.fromCharCode(0x2069)
    + ']',
);

function hasBidiOverride(s: string): boolean {
    return BIDI_OVERRIDE.test(s);
}

// ---------- Public normalizers ----------------------------------------------

export function normalizeTitle(raw: string): NormalizeResult {
    if (typeof raw !== 'string') {
        return { ok: false, code: 'INVALID_TITLE', message: 'title must be a string.' };
    }
    let s = raw.normalize('NFC');
    if (hasBidiOverride(s)) {
        return { ok: false, code: 'INVALID_TITLE_BIDI', message: 'title contains disallowed BiDi override characters.' };
    }
    s = stripControls(s, /* allowTabLf */ false);
    s = stripZeroWidth(s);
    s = s.trim();
    const len = codePointLength(s);
    if (len < 1 || len > 200) {
        return { ok: false, code: 'INVALID_TITLE_LENGTH', message: 'title length out of bounds after normalization.' };
    }
    return { ok: true, value: s };
}

export function normalizeDescription(raw: string): NormalizeResult {
    if (typeof raw !== 'string') {
        return { ok: false, code: 'INVALID_DESCRIPTION', message: 'description must be a string.' };
    }
    let s = raw.normalize('NFC');
    if (hasBidiOverride(s)) {
        return { ok: false, code: 'INVALID_DESCRIPTION_BIDI', message: 'description contains disallowed BiDi override characters.' };
    }
    s = stripControls(s, /* allowTabLf */ true);
    const cpLen = codePointLength(s);
    const zwCount = countZeroWidth(s);
    const zwCap = Math.max(ZERO_WIDTH_DESC_MAX_PER_100, Math.floor((cpLen / 100) * ZERO_WIDTH_DESC_MAX_PER_100));
    if (zwCount > zwCap) {
        s = stripZeroWidth(s);
    }
    s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
    s = s.trim();
    const finalLen = codePointLength(s);
    if (finalLen < 1 || finalLen > 2000) {
        return { ok: false, code: 'INVALID_DESCRIPTION_LENGTH', message: 'description length out of bounds after normalization.' };
    }
    return { ok: true, value: s };
}

export function normalizeDisplayName(raw: string): NormalizeResult {
    if (typeof raw !== 'string') {
        return { ok: false, code: 'INVALID_DISPLAY_NAME', message: 'display name must be a string.' };
    }
    let s = raw.normalize('NFC');
    if (hasBidiOverride(s)) {
        return { ok: false, code: 'INVALID_DISPLAY_NAME_BIDI', message: 'display name contains disallowed BiDi override characters.' };
    }
    s = stripControls(s, /* allowTabLf */ false);
    s = stripZeroWidth(s);
    s = s.trim();
    const len = codePointLength(s);
    if (len < 1 || len > 80) {
        return { ok: false, code: 'INVALID_DISPLAY_NAME_LENGTH', message: 'display name length out of bounds after normalization.' };
    }
    return { ok: true, value: s };
}

// ---------- Content-Disposition filename sanitizer (OI-14 a) ----------------
// Strips CR / LF / control chars + path separators + quote characters so the
// result is safe to splice into `Content-Disposition: attachment; filename="..."`.
// Per RFC 6266 the quoted-string form forbids CTL + DQUOTE + backslash; we
// also flatten path separators so an upstream string can't escape the
// download filename. Non-ASCII falls back to a placeholder ASCII slug; the
// caller can layer RFC 5987 filename* with the original Unicode if needed.

const FILENAME_UNSAFE = /[\x00-\x1f\x7f"\\\/:*?<>|\r\n]/g;
const FILENAME_NON_ASCII = /[^\x20-\x7e]/g;

export function sanitizeFilename(raw: string, fallback = 'file'): string {
    if (typeof raw !== 'string' || raw.length === 0) return fallback;
    let s = raw.replace(FILENAME_UNSAFE, '_');
    s = s.replace(FILENAME_NON_ASCII, '_');
    s = s.replace(/_{2,}/g, '_').replace(/^[._-]+|[._-]+$/g, '');
    if (s.length === 0) return fallback;
    return s.slice(0, 100);
}
