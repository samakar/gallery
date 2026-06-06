/**
 * One-shot: point the MPL-Core Collection's URI at our platform's
 * /collection.json route so Solana Explorer / DAS indexers can populate the
 * Collection page (symbol, website, description, cover image).
 *
 * The collection's update_authority is COLD_RECOVERY_KEY, so it signs the
 * updateCollectionV1 tx. HOT_MINT_KEY pays the fee (umi.identity).
 *
 * Run:
 *   tsx scripts/update_collection_metadata.ts
 *
 * Verify:
 *   1. Open https://explorer.solana.com/address/<PLATFORM_COLLECTION_PUBKEY>?cluster=devnet
 *   2. Symbol should now read "epimage", a Website link should appear, the
 *      cover image should render. May take a minute for DAS to re-index.
 *
 * Re-run safely: idempotent -- if the on-chain URI already matches the target,
 * the tx is skipped.
 *
 * Heads-up: Solana Explorer caches off-chain metadata aggressively. If the
 * page still shows the old empty state after the tx confirms, append a
 * cache-buster query param to the URI (e.g. ?v=2) and re-run. Most indexers
 * key off the full URI string for cache invalidation.
 */

import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import bs58 from 'bs58';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { keypairIdentity, publicKey, createSignerFromKeypair, type Umi } from '@metaplex-foundation/umi';
import { mplCore, updateCollectionV1, fetchCollection } from '@metaplex-foundation/mpl-core';

const RPC_URL = process.env.SOLANA_RPC ?? 'https://api.devnet.solana.com';
const ENV_PATH = path.join(process.cwd(), '.env');

function readEnv(): Record<string, string> {
    if (!fs.existsSync(ENV_PATH)) return {};
    const body = fs.readFileSync(ENV_PATH, 'utf-8');
    const out: Record<string, string> = {};
    for (const line of body.split(/\r?\n/)) {
        const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
        if (m) out[m[1]] = m[2];
    }
    return out;
}

function umiKeypairFromBase58(umi: Umi, secret: string) {
    const arr = bs58.decode(secret);
    if (arr.length !== 64) throw new Error(`invalid secret key length ${arr.length}`);
    return umi.eddsa.createKeypairFromSecretKey(arr);
}

async function main() {
    const env = readEnv();

    const collectionPubkey = env.PLATFORM_COLLECTION_PUBKEY;
    if (!collectionPubkey) {
        console.error('PLATFORM_COLLECTION_PUBKEY missing from .env. Run scripts/cnft_setup.ts first.');
        process.exit(1);
    }
    if (!env.HOT_MINT_KEY || !env.COLD_RECOVERY_KEY) {
        console.error('HOT_MINT_KEY and COLD_RECOVERY_KEY required in .env.');
        process.exit(1);
    }

    const baseUrl = process.env.PLATFORM_BASE_URL ?? env.PLATFORM_BASE_URL ?? 'https://epimage.com';
    const targetUri = `${baseUrl}/collection.json`;

    const umi = createUmi(RPC_URL).use(mplCore());
    const hotMintKp = umiKeypairFromBase58(umi, env.HOT_MINT_KEY);
    const coldKp = umiKeypairFromBase58(umi, env.COLD_RECOVERY_KEY);
    umi.use(keypairIdentity(hotMintKp));
    const coldSigner = createSignerFromKeypair(umi, coldKp);

    console.log('== Update Collection metadata ==');
    console.log(`  RPC:        ${RPC_URL}`);
    console.log(`  collection: ${collectionPubkey}`);
    console.log(`  target URI: ${targetUri}`);
    console.log(`  payer:      ${hotMintKp.publicKey.toString()}  (HOT_MINT_KEY)`);
    console.log(`  authority:  ${coldKp.publicKey.toString()}  (COLD_RECOVERY_KEY)`);

    const onchain = await fetchCollection(umi, publicKey(collectionPubkey));
    console.log(`  current name: "${onchain.name}"`);
    console.log(`  current uri:  "${onchain.uri}"`);

    if (onchain.uri === targetUri) {
        console.log('\nURI already matches target. Nothing to do.');
        console.log(`Open: https://explorer.solana.com/address/${collectionPubkey}?cluster=devnet`);
        return;
    }

    console.log('\nSubmitting updateCollectionV1 ...');
    const tx = await updateCollectionV1(umi, {
        collection: publicKey(collectionPubkey),
        authority: coldSigner,
        newName: onchain.name,    // leave name alone
        newUri: targetUri,
    }).sendAndConfirm(umi);

    console.log(`  tx: ${bs58.encode(tx.signature)}`);
    console.log(`\nDone. Verify in ~30s at:`);
    console.log(`  https://explorer.solana.com/address/${collectionPubkey}?cluster=devnet`);
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
