// legal.ts
// Reads the demo contracts from /legal/, computes deterministic version
// hashes, and exposes them to the ESIGN endpoints. Each contract is read
// once at startup and cached in memory -- text changes require a server
// restart (intentional; signatures committed during one process lifetime
// will continue to verify against the hash that was active then).

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export type LegalDocType =
    | 'CMA'
    | 'MJA'
    | 'COA'   // per binder.entries; sourced from legal/isa.md (kept under legacy filename)
    | 'SAL'   // per binder.entries; sourced from legal/license_acceptance.md (kept under legacy filename)
    | 'DLN'
    | 'TOS'
    | 'PRIVACY';

export interface LegalDoc {
    type: LegalDocType;
    label: string;          // first line of the file ("Version: ...")
    text: string;           // full text
    hash: string;           // sha256 hex of text
}

const FILE_MAP: Record<LegalDocType, string> = {
    CMA: 'cma.md',
    MJA: 'mja.md',
    COA: 'isa.md',                       // legacy filename kept; binder/code call this COA
    SAL: 'license_acceptance.md',        // legacy filename kept; binder/code call this SAL
    DLN: 'download_notice.md',
    TOS: 'tos.md',
    PRIVACY: 'privacy.md',
};

const cache = new Map<LegalDocType, LegalDoc>();

function loadDoc(type: LegalDocType): LegalDoc {
    const cached = cache.get(type);
    if (cached) return cached;
    const filename = FILE_MAP[type];
    // /legal lives at the repo root, same level as src/.
    const filepath = path.resolve(process.cwd(), 'legal', filename);
    const text = readFileSync(filepath, 'utf-8');
    const firstLine = text.split('\n', 1)[0]?.trim() ?? '';
    const label = firstLine.startsWith('Version:') ? firstLine.replace(/^Version:\s*/, '') : 'unknown';
    const hash = createHash('sha256').update(text).digest('hex');
    const doc: LegalDoc = { type, label, text, hash };
    cache.set(type, doc);
    return doc;
}

export function getLegalDoc(type: LegalDocType): LegalDoc {
    return loadDoc(type);
}

export function listLegalDocs(): LegalDoc[] {
    return (Object.keys(FILE_MAP) as LegalDocType[]).map(loadDoc);
}
