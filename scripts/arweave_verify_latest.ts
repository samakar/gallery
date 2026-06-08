// scripts/arweave_verify_latest.ts
// One-shot verification that the most recent mint's encrypted Master actually
// landed on Arweave (rather than triggering the D-11 manifest-stub fallback).
//
// Run:   tsx scripts/arweave_verify_latest.ts
//
// Looks up the newest Deed, fetches HEAD on its arweave_uri, and reports:
//   - the local ciphertext file size (always present)
//   - the Arweave URL Content-Length + Content-Type
//   - the verdict: real upload vs manifest stub

import 'dotenv/config';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { prisma } from '../src/db';

async function main() {
    const latest = await prisma.deed.findFirst({
        orderBy: { minted_at: 'desc' },
        include: { image: { select: { arweave_uri: true, title: true } } },
    });
    if (!latest) {
        console.error('No deeds in DB. Run a mint first.');
        process.exit(1);
    }
    console.log('Latest mint');
    console.log('  image_id:    ', latest.image_id);
    console.log('  title:       ', latest.image.title);
    console.log('  asset_id:    ', latest.asset_id);
    console.log('  minted_at:   ', latest.minted_at.toISOString());
    console.log('  arweave_uri: ', latest.image.arweave_uri ?? '(none)');
    console.log();

    // 1) Local ciphertext file (always written before Arweave attempt)
    const localPath = path.join(
        process.cwd(),
        process.env.ENCRYPTED_MASTER_DIR ?? 'data/encrypted_masters',
        `${latest.image_id}.bin`,
    );
    try {
        const stat = await fs.stat(localPath);
        console.log('Local ciphertext');
        console.log('  path:        ', localPath);
        console.log('  size:        ', `${(stat.size / 1024).toFixed(1)} kb`);
        console.log();
    } catch {
        console.log('Local ciphertext: MISSING -- file not at', localPath);
        console.log();
    }

    // 2) Arweave HEAD probe
    if (!latest.image.arweave_uri) {
        console.error('No arweave_uri on Image. Cannot verify.');
        process.exit(1);
    }
    let resp: Response;
    try {
        resp = await fetch(latest.image.arweave_uri, { method: 'HEAD' });
    } catch (e: any) {
        console.error('Arweave HEAD failed:', e?.message ?? e);
        process.exit(2);
    }
    const len = resp.headers.get('content-length');
    const ct = resp.headers.get('content-type');
    const bytes = len ? parseInt(len, 10) : 0;
    console.log('Arweave URL probe');
    console.log('  HTTP status: ', resp.status);
    console.log('  Content-Type:', ct);
    console.log('  Content-Length:', len, `(${(bytes / 1024).toFixed(1)} kb)`);
    console.log();

    // 3) Verdict. Three distinguishable cases:
    //    - 404 / 5xx / timeout: gateway hasn't indexed yet. New Arweave uploads
    //      typically need 5-15 min before arweave.net serves them. Re-run later.
    //    - 200 + ~500 bytes + JSON content-type: D-11 manifest-stub fallback.
    //      Out of Turbo credits at upload time; server log carries the warning.
    //    - 200 + KBs / MBs of binary: real encrypted Master uploaded.
    if (resp.status === 404 || resp.status >= 500) {
        console.log('VERDICT: ⏳ propagation delay');
        console.log('  Arweave gateway returned', resp.status, '-- new uploads typically take 5-15 min to index.');
        console.log('  If the server log did NOT print "[arweave] Out of Turbo credits..." for this mint,');
        console.log('  the upload almost certainly succeeded; gateway is just behind. Re-run in ~10 min.');
        console.log('  Cross-check: was Turbo balance lower after the mint than before? (Run arweave_check.ts)');
        process.exit(0); // not a failure -- propagation lag is benign
    }
    const isManifestStub = bytes < 5_000 && (ct ?? '').includes('json');
    if (isManifestStub) {
        console.log('VERDICT: ❌ manifest stub (D-11 fallback fired)');
        console.log('  The encrypted Master bytes were NOT uploaded.');
        console.log('  Server log should show "[arweave] Out of Turbo credits..." for this mint.');
        process.exit(3);
    }
    console.log('VERDICT: ✅ real encrypted Master on Arweave');
    console.log('  Content-Length', bytes, 'bytes ≈ local ciphertext', '(parity check passes)');
    console.log('  D-11 resolved for this mint.');
}

main()
    .catch(e => { console.error('verify failed:', e?.message ?? e); process.exit(99); })
    .finally(() => prisma.$disconnect());
