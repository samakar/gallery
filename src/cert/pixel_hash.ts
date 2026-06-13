// pixel_hash.ts
//
// Computes `pixel_sha256` -- the deed's pixel-content identity anchor.
//
// Definition: sha256 over the JPEG file with metadata marker segments
// surgically removed (compressed scan data byte-exact, no decoding involved).
// Tool-independent given a precise strip rule. Distinguishes "pixels intact +
// metadata edited" from "pixels altered" in a way `sha256` (full-file) and
// `phash` (perceptual similarity) cannot.
//
// Strip rule (exhaustive):
//   - APP1 marker (0xFFE1)  -- carries EXIF and XMP
//   - APP2 marker (0xFFE2)  -- carries ICC profile + MPF
//   - APP13 marker (0xFFED) -- carries IPTC + Photoshop IRB
//   - COM marker (0xFFFE)   -- comment segments
// Everything else is kept byte-exact: SOI, EOI, JFIF (APP0), DQT, DHT, SOF*,
// SOS, entropy-coded scan data, RST markers, DRI, DNL.
//
// Format support at MVP: JPEG only. PNG / TIFF / HEIC / WebP return null and
// the deed records `pixel_sha256: null`. Adding parsers for other containers
// is mechanical when needed.

import { createHash } from 'node:crypto';

// JPEG marker codes (the byte after 0xFF).
const M_SOI  = 0xD8;
const M_EOI  = 0xD9;
const M_SOS  = 0xDA;
const M_TEM  = 0x01;
// Restart markers RST0..RST7 = 0xD0..0xD7 (no payload).
const M_RST_LO = 0xD0;
const M_RST_HI = 0xD7;

// Metadata markers to strip.
const STRIP = new Set([
    0xE1,   // APP1 -- EXIF + XMP
    0xE2,   // APP2 -- ICC + MPF
    0xED,   // APP13 -- IPTC + Photoshop IRB
    0xFE,   // COM
]);

function isJpeg(buf: Buffer): boolean {
    return buf.length >= 4 && buf[0] === 0xFF && buf[1] === M_SOI;
}

// Walk JPEG markers, collect the byte ranges to KEEP, concatenate, hash.
// Returns null on malformed input (any unexpected shape) so the caller writes
// pixel_sha256=null rather than persisting a hash of partial / wrong bytes.
function stripJpegMetadata(buf: Buffer): Buffer | null {
    if (!isJpeg(buf)) return null;
    const kept: Buffer[] = [];
    let i = 0;
    const n = buf.length;

    while (i < n) {
        // Need a marker prefix (0xFF, possibly preceded by stuffing 0xFFs).
        if (buf[i] !== 0xFF) return null;
        // Skip any 0xFF padding (stuffing bytes between markers).
        let j = i;
        while (j < n - 1 && buf[j + 1] === 0xFF) j++;
        if (j >= n - 1) return null;
        const marker = buf[j + 1];
        // The 0xFF run plus the marker byte span: [i .. j+1] inclusive.
        const markerStart = i;
        const markerEnd = j + 2;  // exclusive

        // SOI and TEM: standalone, no length field. Keep.
        if (marker === M_SOI || marker === M_TEM) {
            kept.push(buf.subarray(markerStart, markerEnd));
            i = markerEnd;
            continue;
        }

        // EOI: end of image, no payload, keep, stop.
        if (marker === M_EOI) {
            kept.push(buf.subarray(markerStart, markerEnd));
            i = markerEnd;
            break;
        }

        // RST0..RST7: restart markers, standalone, keep.
        if (marker >= M_RST_LO && marker <= M_RST_HI) {
            kept.push(buf.subarray(markerStart, markerEnd));
            i = markerEnd;
            continue;
        }

        // All other markers carry a 2-byte length field immediately after.
        if (markerEnd + 2 > n) return null;
        const segLen = (buf[markerEnd] << 8) | buf[markerEnd + 1];
        if (segLen < 2) return null;
        const segEnd = markerEnd + segLen;  // exclusive (length field is included in segLen)
        if (segEnd > n) return null;

        if (marker === M_SOS) {
            // SOS segment carries scan parameters, then entropy-coded data
            // follows until a real marker (RST*, EOI, or another SOS for
            // progressive). Keep the SOS segment header, then walk the
            // entropy data byte-by-byte to find the next real marker.
            kept.push(buf.subarray(markerStart, segEnd));
            let k = segEnd;
            while (k < n) {
                if (buf[k] !== 0xFF) { k++; continue; }
                // Look ahead past stuffing.
                let m = k;
                while (m < n - 1 && buf[m + 1] === 0xFF) m++;
                if (m >= n - 1) { k = m + 1; continue; }
                const next = buf[m + 1];
                // 0xFF00 = literal 0xFF in entropy data, NOT a marker. Keep.
                if (next === 0x00) { k = m + 2; continue; }
                // RST markers (FF D0..D7) are valid mid-scan markers; keep
                // them as part of the scan run.
                if (next >= M_RST_LO && next <= M_RST_HI) { k = m + 2; continue; }
                // Anything else: real marker. End the scan run here.
                // Keep the entropy run from segEnd to k (exclusive).
                kept.push(buf.subarray(segEnd, k));
                i = k;
                break;
            }
            if (k >= n) {
                // Scan ran to end of file without finding a closing marker.
                // Keep the rest and exit.
                kept.push(buf.subarray(segEnd, n));
                i = n;
            }
            continue;
        }

        // Metadata marker we strip -- skip the whole segment.
        if (STRIP.has(marker)) {
            i = segEnd;
            continue;
        }

        // Keep the segment as-is.
        kept.push(buf.subarray(markerStart, segEnd));
        i = segEnd;
    }

    return Buffer.concat(kept);
}

// Public entry point. Returns hex sha256 of the stripped JPEG bitstream, or
// null for non-JPEG containers / malformed input.
export function computePixelSha256(buf: Buffer): string | null {
    const stripped = stripJpegMetadata(buf);
    if (!stripped) return null;
    return createHash('sha256').update(stripped).digest('hex');
}
