// scripts/arweave_topup.ts
// Generate a Stripe checkout URL that credits Turbo to our server's Arweave
// wallet. No browser wallet extension required -- the SDK creates a hosted
// Stripe checkout session pointing at our wallet address; pay with a card;
// credits land in our wallet within seconds.
//
// Run:
//   tsx scripts/arweave_topup.ts                 # default $10
//   tsx scripts/arweave_topup.ts 25              # $25
//
// Output:
//   A URL. Open it in a browser, pay with card, run arweave_check.ts to verify.

import 'dotenv/config';
import Arweave from 'arweave';
import { TurboFactory } from '@ardrive/turbo-sdk';

async function main() {
    const usd = Number(process.argv[2] ?? '10');
    if (!Number.isFinite(usd) || usd < 5) {
        console.error('Usage: tsx scripts/arweave_topup.ts <usd-amount> (min 5)');
        process.exit(1);
    }
    const jwkBase64 = process.env.ARWEAVE_JWK_BASE64;
    if (!jwkBase64) {
        console.error('ARWEAVE_JWK_BASE64 not set in .env');
        process.exit(1);
    }
    const jwk = JSON.parse(Buffer.from(jwkBase64, 'base64').toString('utf-8'));
    const address = await Arweave.init({}).wallets.jwkToAddress(jwk);

    // Unauthenticated client is sufficient -- we're just creating a Stripe
    // checkout for a known recipient address, not signing anything.
    const turbo = TurboFactory.unauthenticated({ token: 'arweave' });
    const session = await turbo.createCheckoutSession({
        amount: { type: 'usd', amount: usd * 100 }, // cents
        owner: address,
    });

    console.log('Top-up session created');
    console.log('  Wallet address:', address);
    console.log('  Amount:        ', `$${usd}`);
    console.log('  Estimated winc:', session.winc);
    console.log();
    console.log('Open this URL in a browser, complete payment with card:');
    console.log();
    console.log('  ' + session.url);
    console.log();
    console.log('After paying, run: npx tsx scripts/arweave_check.ts');
}

main().catch(e => {
    console.error('Top-up failed:', e?.message ?? e);
    process.exit(2);
});
