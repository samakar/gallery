// scripts/build_legal_binder.ts
//
// Builds the MVP-launch legal binder (`binder_version: 1`) from the current
// `legal/*.md` files. Writes two outputs:
//
//   data/legal_binder.json       -- byte-identical to what will be uploaded to Arweave
//   data/legal_binder.meta.json  -- { arweave_tx_id, uploaded_at }; arweave_tx_id
//                                   is null until `release-binder` actually performs
//                                   the upload.
//
// File-to-entry mapping (per legal_binder.md):
//   CMA -> legal/cma.md
//   MJA -> legal/mja.md
//   COA -> legal/isa.md                       (file kept under its pre-rename name)
//   SAL -> legal/license_acceptance.md        (file kept under its pre-rename name)
//   DLN -> legal/download_notice.md           (Master Download Notice -- buyer's
//                                              pre-download consent; gates sealed -> unsealed)
//
// Per legal_binder.md MVP scope:
//   - binder_version is always 1
//   - supersedes_arweave_tx_id is always null
//   - revisions are post-MVP
//
// Run: npx tsx scripts/build_legal_binder.ts

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = dirname(dirname(__filename));
const LEGAL_DIR = join(REPO_ROOT, 'legal');
const DATA_DIR = join(REPO_ROOT, 'data');

const BINDER_JSON = join(DATA_DIR, 'legal_binder.json');
const BINDER_META = join(DATA_DIR, 'legal_binder.meta.json');

const RELEASED_AT = '2026-06-11T14:00:00.000Z';

interface EntrySpec {
    id: string;          // 5-byte base64 opaque id
    type: 'CMA' | 'MJA' | 'COA' | 'SAL' | 'DLN';
    version: string;     // per-document version label, matches the Version: line at the top of the source markdown
    sourceFile: string;
    propsSchema: Record<string, string>;
    notes: string;
}

const ENTRIES: EntrySpec[] = [
    {
        id: 'cma37',
        type: 'CMA',
        version: '1.0',
        sourceFile: 'cma.md',
        propsSchema: {},
        notes: 'Initial release (includes §2.4-2.6 Master-preservation commitments)',
    },
    {
        id: 'mja4k',
        type: 'MJA',
        version: '1.0',
        sourceFile: 'mja.md',
        propsSchema: {},
        notes: 'Initial release',
    },
    {
        id: 'coaQ2',
        type: 'COA',
        version: '1.0',
        sourceFile: 'isa.md',
        propsSchema: {
            image_id: 'string',
            sha256_master: 'string',
            creation_date: 'string',
            creator_display_name: 'string',
            edition: 'string',
        },
        notes: 'Initial release (markdown source supersedes prior ISA naming; renders to PDF at mint)',
    },
    {
        id: 'sal9p',
        type: 'SAL',
        version: '1.0',
        sourceFile: 'license_acceptance.md',
        propsSchema: {
            image_id: 'string',
            royalty_pct: 'number',
            edition: 'string',
            platform_fee_pct: 'number',
        },
        notes: 'Initial release (combines prior LICENSE_ACCEPTANCE scope + sale-terms)',
    },
    {
        id: 'dln7t',
        type: 'DLN',
        version: '1.0',
        sourceFile: 'download_notice.md',
        propsSchema: {
            image_id: 'string',
            initials: 'string',
            owner_wallet_address: 'string',
        },
        notes: 'Initial release -- buyer\'s pre-download acknowledgement gating sealed -> unsealed',
    },
];

function sha256Hex(s: string): string {
    return createHash('sha256').update(s, 'utf8').digest('hex');
}

function atomicWrite(targetPath: string, content: string): void {
    const tmp = `${targetPath}.tmp`;
    writeFileSync(tmp, content, { encoding: 'utf8' });
    renameSync(tmp, targetPath);
}

function buildBinder() {
    const entries = ENTRIES.map(e => {
        const content = readFileSync(join(LEGAL_DIR, e.sourceFile), 'utf8');
        return {
            id: e.id,
            type: e.type,
            version: e.version,
            released_at: RELEASED_AT,
            format: 'md',
            notes: e.notes,
            content,
            content_sha256: sha256Hex(content),
            props_schema: e.propsSchema,
        };
    });

    // Build the binder body WITHOUT binder_sha256, compute the hash, then attach it.
    // At verify time: parse the binder, strip binder_sha256 (treat as ''), re-stringify
    // with the same canonical formatting, recompute -- result must match.
    const body = {
        binder_version: 1 as const,
        released_at: RELEASED_AT,
        supersedes_arweave_tx_id: null,
        binder_sha256: '',
        entries,
    };
    const canonical = JSON.stringify(body, null, 2);
    body.binder_sha256 = sha256Hex(canonical);
    return JSON.stringify(body, null, 2);
}

function buildMeta() {
    return JSON.stringify(
        {
            arweave_tx_id: null,
            uploaded_at: null,
        },
        null,
        2,
    );
}

mkdirSync(DATA_DIR, { recursive: true });
atomicWrite(BINDER_JSON, buildBinder());
atomicWrite(BINDER_META, buildMeta());

console.log(`Wrote ${BINDER_JSON}`);
console.log(`Wrote ${BINDER_META}`);
console.log('arweave_tx_id remains null until the Arweave upload runs.');
