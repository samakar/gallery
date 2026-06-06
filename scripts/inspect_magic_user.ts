/**
 * Pull the raw Magic admin metadata for the current samakar@gmail.com identity,
 * asking for both ETH and SOLANA wallet types. The full JSON of `wallets[]` is
 * what we need to send back to Magic support so they can't claim our query is
 * wrong -- the response is theirs to explain.
 *
 * Run: tsx scripts/inspect_magic_user.ts
 */
import 'dotenv/config';
import { Magic } from '@magic-sdk/admin';
import { prisma } from '../src/db';

(async () => {
    const secret = process.env.MAGIC_SECRET_KEY;
    if (!secret) throw new Error('MAGIC_SECRET_KEY missing in .env');
    const magicAdmin = await Magic.init(secret);

    const u = await prisma.user.findFirst({ where: { email: 'samakar@gmail.com' } });
    if (!u) {
        console.log('No user row -- sign in first');
        await prisma.$disconnect();
        return;
    }
    console.log('--- Local DB state ---');
    console.log({ email: u.email, wallet_address: u.wallet_address, magic_did: u.magic_did });

    const issuer = u.magic_did;
    if (!issuer) throw new Error('user has no magic_did');

    console.log('\n--- Magic admin SDK: getMetadataByIssuerAndWallet(..., WalletType.ETH) ---');
    try {
        const meta = await magicAdmin.users.getMetadataByIssuerAndWallet(issuer, 'ETH' as any);
        console.log(JSON.stringify(meta, null, 2));
    } catch (e: any) {
        console.log('ERROR:', e?.message ?? e);
    }

    console.log('\n--- Magic admin SDK: getMetadataByIssuerAndWallet(..., WalletType.SOLANA) ---');
    try {
        const meta = await magicAdmin.users.getMetadataByIssuerAndWallet(issuer, 'SOLANA' as any);
        console.log(JSON.stringify(meta, null, 2));
    } catch (e: any) {
        console.log('ERROR:', e?.message ?? e);
    }

    console.log('\n--- Magic admin SDK: getMetadataByIssuerAndWallet(..., WalletType.ANY) ---');
    try {
        const meta = await magicAdmin.users.getMetadataByIssuerAndWallet(issuer, 'ANY' as any);
        console.log(JSON.stringify(meta, null, 2));
    } catch (e: any) {
        console.log('ERROR:', e?.message ?? e);
    }

    await prisma.$disconnect();
})();
