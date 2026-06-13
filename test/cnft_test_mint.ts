/**
 * End-to-end test mint -- calls cnft_dispatch.dispatch directly with synthetic
 * inputs so we can exercise the full mint pipeline (Arweave metadata upload +
 * Bubblegum V2 mintV2 + asset_id verification) without going through Stripe /
 * Magic / Cloudinary.
 *
 * Run: tsx scripts/cnft_test_mint.ts
 *
 * Outputs the asset_id + tx signature + Arweave URI. Look up the asset on
 * https://xray.helius.xyz/?cluster=devnet with the asset_id (or solscan.io
 * with the tx) to confirm the on-chain shape.
 */

import 'dotenv/config';
import { Keypair as Web3Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { dispatch } from '../src/registry/cnft_dispatch';

async function main() {
    // Synthetic buyer wallet for the test mint.
    const buyer = Web3Keypair.generate();
    const buyerPubkey = buyer.publicKey.toBase58();

    console.log('== Test mint inputs ==');
    console.log(`  buyer (test):   ${buyerPubkey}`);
    console.log(`  buyer secret:   ${bs58.encode(buyer.secretKey)}  (throwaway; do not reuse)`);
    console.log('');

    const result = await dispatch({
        image_id: 'test1',
        buyer_wallet: buyerPubkey,
        buyer_email: 'test@example.com',
        title: 'Test Mint',
        description: 'End-to-end mint smoke test for Bubblegum V2 cNFT pipeline',
        creator_display_name: 'Test Creator',
        preview_url: 'https://www.crossmint.com/assets/crossmint/logo.png',
        arweave_uri: 'ar://test-master-uri-placeholder',
        sha256: 'a'.repeat(64),
        phash: 'b'.repeat(16),
        enc_final: null,
        license_signing_event_id: null,
        royalty_pct: 10,
        creator_wallet: null,
    });

    if (!result.ok) {
        console.error(`FAILED: ${result.error_code}: ${result.message}`);
        process.exit(1);
    }

    console.log('== Test mint succeeded ==');
    console.log(`  asset_id:             ${result.asset_id}`);
    console.log(`  tx signature:         ${result.crossmint_job_id}`);
    console.log(`  arweave_metadata_uri: ${result.arweave_metadata_uri}`);
    console.log('');
    console.log('Inspect on-chain:');
    console.log(`  https://xray.helius.xyz/token/${result.asset_id}?network=devnet`);
    console.log(`  https://solscan.io/tx/${result.crossmint_job_id}?cluster=devnet`);
}

main().catch(e => {
    console.error('test-mint failed:', e);
    process.exit(1);
});
