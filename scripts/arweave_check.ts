// scripts/arweave_check.ts
// Print the Arweave wallet address + Turbo credit balance so we can fund it.
//
// Run:
//   tsx scripts/arweave_check.ts
//
// Output:
//   - Wallet address (paste this at https://turbo.ardrive.io to top up)
//   - Turbo credit balance (in winston-equivalent "winc" units; 10^12 winc = 1 AR)
//   - Approximate uploads remaining at typical Master size

import 'dotenv/config';
import Arweave from 'arweave';
import { TurboFactory, ArweaveSigner } from '@ardrive/turbo-sdk';

async function main() {
    const jwkBase64 = process.env.ARWEAVE_JWK_BASE64;
    if (!jwkBase64) {
        console.error('ARWEAVE_JWK_BASE64 not set in .env');
        process.exit(1);
    }
    const jwk = JSON.parse(Buffer.from(jwkBase64, 'base64').toString('utf-8'));

    const arweave = Arweave.init({});
    const address = await arweave.wallets.jwkToAddress(jwk);
    console.log('Arweave wallet address:');
    console.log('  ' + address);
    console.log();

    const turbo = TurboFactory.authenticated({
        signer: new ArweaveSigner(jwk),
        token: 'arweave',
    });
    const { winc } = await turbo.getBalance();
    const wincNum = BigInt(winc);
    console.log('Turbo credit balance:');
    console.log(`  ${winc} winc`);

    // Rough conversion -- cross-checked against ArDrive's calculator:
    // $10 → 3.476T winc → 466 MB upload (per turbo.ar.io/calculator).
    // Implies ~7.46e9 winc per MB. Pricing fluctuates with AR token price;
    // for precise per-upload pricing use turbo.getUploadCosts(bytes).
    const wincPerMb = 7_460_000_000n;
    const approxMb = Number(wincNum / wincPerMb);
    console.log(`  ≈ ${approxMb} MB of upload capacity remaining (rough)`);
    console.log();

    if (wincNum === 0n) {
        console.log('No credits. To fund:');
        console.log('  1. Open https://turbo.ardrive.io');
        console.log('  2. Paste the wallet address above');
        console.log('  3. Top up with credit card (try $10 to start)');
        console.log('  4. Re-run this script to verify');
    } else {
        const masterMb = 8;
        const mintsRemaining = Math.floor(approxMb / masterMb);
        console.log(`Approximate mints remaining at ${masterMb} MB each:  ${mintsRemaining}`);
        console.log('Top up at https://turbo.ardrive.io when low.');
    }
}

main().catch(e => {
    console.error('Failed:', e?.message ?? e);
    process.exit(2);
});
