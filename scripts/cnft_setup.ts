/**
 * One-time setup for Bubblegum V2 cNFT minting per /docs/registry/mint_architecture.md §4.
 *
 * Generates four keypairs (Option-a from the proposal -- all hot at MVP, separated for clean
 * rotation to cold custody post-MVP):
 *   HOT_MINT_KEY       -- tree delegate, signs mint_v1
 *   HOT_OPS_KEY        -- tree authority, signs update_metadata_v1
 *   HOT_RESALE_KEY     -- PermanentTransferDelegate.authority, signs resale transfers
 *   COLD_RECOVERY_KEY  -- collection update_authority + PermanentFreezeDelegate.authority
 *
 * Creates the MPL-Core Collection with the plugin stack and the Bubblegum V2 tree.
 *
 * Run:    tsx scripts/cnft_setup.ts
 * Repeat: idempotent -- skips creation if .env already has the corresponding pubkey
 *
 * Requires HOT_MINT_KEY to have ~0.3 SOL on devnet. The script tries a single airdrop;
 * if that fails it prints a funding URL and exits so you can top up via solfaucet.com.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Keypair as Web3Keypair, Connection, LAMPORTS_PER_SOL, PublicKey as Web3PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { createSignerFromKeypair, generateSigner, keypairIdentity, percentAmount, publicKey, type Keypair as UmiKeypair, type Signer, type Umi } from '@metaplex-foundation/umi';
import { createTreeV2, mplBubblegum } from '@metaplex-foundation/mpl-bubblegum';
import { createCollection, mplCore } from '@metaplex-foundation/mpl-core';

const RPC_URL = process.env.SOLANA_RPC ?? 'https://api.devnet.solana.com';
const ENV_PATH = path.join(process.cwd(), '.env');

// Dev / staging tree -- small + cheap (~0.04 SOL rent vs ~0.68 SOL for the
// full depth-14 canopy-10 production target). 1024 leaves is plenty for
// development volume. Roll a larger tree at prod-deploy time; existing
// dev-tree mints stay valid in their original tree.
const TREE_MAX_DEPTH = 10;        // 2^10 = 1,024 leaves
const TREE_MAX_BUFFER_SIZE = 32;
const TREE_CANOPY_DEPTH = 0;      // proof carries 10 hashes (~320 bytes), fits in single tx

// --------------------------------------------------------------------------- //
// .env helpers (read-only fetch + append on miss)
// --------------------------------------------------------------------------- //
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

function appendEnv(updates: Record<string, string>): void {
    const existing = readEnv();
    const toAppend: string[] = [];
    for (const [k, v] of Object.entries(updates)) {
        if (existing[k] !== undefined && existing[k] !== '') continue;
        toAppend.push(`${k}=${v}`);
    }
    if (toAppend.length === 0) return;
    const prefix = fs.existsSync(ENV_PATH) && !fs.readFileSync(ENV_PATH, 'utf-8').endsWith('\n') ? '\n' : '';
    fs.appendFileSync(ENV_PATH, prefix + '# --- cNFT setup additions ---\n' + toAppend.join('\n') + '\n');
}

// --------------------------------------------------------------------------- //
// Keypair helpers (Solana base58 secret key <-> Umi signer)
// --------------------------------------------------------------------------- //
function keypairFromBase58(secret: string, umi: Umi): UmiKeypair {
    const arr = bs58.decode(secret);
    if (arr.length !== 64) throw new Error(`invalid secret key length ${arr.length} (expected 64)`);
    const kp = umi.eddsa.createKeypairFromSecretKey(arr);
    return kp;
}

function ensureKey(name: string, env: Record<string, string>, umi: Umi): { signer: Signer; pubkey: string; secretBase58: string } {
    const existing = env[name];
    if (existing) {
        const kp = keypairFromBase58(existing, umi);
        return { signer: createSignerFromKeypair(umi, kp), pubkey: kp.publicKey.toString(), secretBase58: existing };
    }
    const web3kp = Web3Keypair.generate();
    const secretBase58 = bs58.encode(web3kp.secretKey);
    const kp = umi.eddsa.createKeypairFromSecretKey(web3kp.secretKey);
    return { signer: createSignerFromKeypair(umi, kp), pubkey: kp.publicKey.toString(), secretBase58 };
}

// --------------------------------------------------------------------------- //
// Devnet funding (best-effort airdrop)
// --------------------------------------------------------------------------- //
async function ensureFunded(connection: Connection, pubkey: string, minLamports: number): Promise<boolean> {
    const balance = await connection.getBalance(new Web3PublicKey(pubkey));
    console.log(`  HOT_MINT_KEY balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
    if (balance >= minLamports) return true;
    console.log(`  attempting devnet airdrop of 1 SOL ...`);
    try {
        const sig = await connection.requestAirdrop(new Web3PublicKey(pubkey), LAMPORTS_PER_SOL);
        await connection.confirmTransaction(sig, 'confirmed');
        const after = await connection.getBalance(new Web3PublicKey(pubkey));
        console.log(`  airdrop landed; balance now ${(after / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
        return after >= minLamports;
    } catch (e: any) {
        console.log(`  airdrop failed: ${e?.message ?? e}`);
        return false;
    }
}

// --------------------------------------------------------------------------- //
// Main
// --------------------------------------------------------------------------- //
async function main() {
    const env = readEnv();
    const umi = createUmi(RPC_URL).use(mplBubblegum()).use(mplCore());

    console.log('== Step 1: keys ==');
    const hotMint = ensureKey('HOT_MINT_KEY', env, umi);
    const hotOps = ensureKey('HOT_OPS_KEY', env, umi);
    const hotResale = ensureKey('HOT_RESALE_KEY', env, umi);
    const coldRecovery = ensureKey('COLD_RECOVERY_KEY', env, umi);
    appendEnv({
        HOT_MINT_KEY: hotMint.secretBase58,
        HOT_OPS_KEY: hotOps.secretBase58,
        HOT_RESALE_KEY: hotResale.secretBase58,
        COLD_RECOVERY_KEY: coldRecovery.secretBase58,
    });
    console.log(`  HOT_MINT_KEY        ${hotMint.pubkey}`);
    console.log(`  HOT_OPS_KEY         ${hotOps.pubkey}`);
    console.log(`  HOT_RESALE_KEY      ${hotResale.pubkey}`);
    console.log(`  COLD_RECOVERY_KEY   ${coldRecovery.pubkey}`);

    // Sign as HOT_MINT_KEY for setup-tx fees
    umi.use(keypairIdentity({ publicKey: publicKey(hotMint.pubkey), secretKey: bs58.decode(hotMint.secretBase58) }));

    console.log('\n== Step 2: funding check ==');
    const connection = new Connection(RPC_URL, 'confirmed');
    const ok = await ensureFunded(connection, hotMint.pubkey, 0.3 * LAMPORTS_PER_SOL);
    if (!ok) {
        console.log(`\nHOT_MINT_KEY needs ~0.3 SOL on devnet to proceed.`);
        console.log(`Fund it via https://solfaucet.com  (paste address: ${hotMint.pubkey})`);
        console.log(`Then re-run: tsx scripts/cnft_setup.ts`);
        process.exit(1);
    }

    console.log('\n== Step 3: MPL-Core Collection ==');
    if (env.PLATFORM_COLLECTION_PUBKEY) {
        console.log(`  already set in .env: ${env.PLATFORM_COLLECTION_PUBKEY} -- skipping`);
    } else {
        const collectionSigner = generateSigner(umi);
        const tx = await createCollection(umi, {
            collection: collectionSigner,
            name: 'Epimage Deeds',
            uri: '',
            updateAuthority: publicKey(coldRecovery.pubkey),
            plugins: [
                {
                    type: 'PermanentFreezeDelegate',
                    frozen: true,
                    authority: { type: 'Address', address: publicKey(coldRecovery.pubkey) },
                },
                {
                    type: 'PermanentTransferDelegate',
                    authority: { type: 'Address', address: publicKey(hotResale.pubkey) },
                },
                {
                    // Authorizes the Bubblegum V2 program to mint cNFTs into this collection.
                    // Without this, mintV2 fails with CollectionMustHaveBubblegumPlugin.
                    type: 'BubblegumV2',
                },
            ],
        }).sendAndConfirm(umi);
        console.log(`  collection created: ${collectionSigner.publicKey}`);
        console.log(`  tx: ${bs58.encode(tx.signature)}`);
        appendEnv({ PLATFORM_COLLECTION_PUBKEY: collectionSigner.publicKey.toString() });
    }

    // Note: BubblegumV2 plugin must be attached at collection creation. The
    // mpl-core program rejects addCollectionPlugin for that specific plugin
    // type ("Invalid Authority"). If you find an existing collection without
    // the plugin, the only fix is to clear PLATFORM_COLLECTION_PUBKEY from
    // .env and re-run to mint a fresh collection. The old collection becomes
    // orphaned.

    console.log('\n== Step 4: Bubblegum V2 tree ==');
    if (env.PLATFORM_TREE_PUBKEY) {
        console.log(`  already set in .env: ${env.PLATFORM_TREE_PUBKEY} -- skipping`);
    } else {
        const merkleTreeSigner = generateSigner(umi);
        // Tree creator = HOT_OPS_KEY (= tree authority). Tree delegate (mint signer) is set
        // separately below. createTreeV2 takes treeCreator as the umi.identity by default;
        // we override by passing the hotOps signer explicitly.
        const tx = await (await createTreeV2(umi, {
            merkleTree: merkleTreeSigner,
            maxDepth: TREE_MAX_DEPTH,
            maxBufferSize: TREE_MAX_BUFFER_SIZE,
            canopyDepth: TREE_CANOPY_DEPTH,
            treeCreator: hotOps.signer,
            public: false,
        })).sendAndConfirm(umi);
        console.log(`  tree created: ${merkleTreeSigner.publicKey}`);
        console.log(`  tx: ${bs58.encode(tx.signature)}`);
        appendEnv({ PLATFORM_TREE_PUBKEY: merkleTreeSigner.publicKey.toString() });
    }

    console.log('\n== Step 5: SOLANA_RPC pin ==');
    if (!env.SOLANA_RPC) {
        appendEnv({ SOLANA_RPC: RPC_URL });
        console.log(`  SOLANA_RPC=${RPC_URL} appended to .env`);
    } else {
        console.log(`  already set: ${env.SOLANA_RPC}`);
    }

    console.log('\nSetup complete. .env contains the new pubkeys + secret keys.');
    console.log('Next: tsx scripts/cnft_setup.ts again will skip everything (idempotent check).');
}

main().catch(e => {
    console.error('setup failed:', e);
    process.exit(1);
});
