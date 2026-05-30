// wallets.ts
// Registry-owned Magic silent wallet provisioning (INV-4).
// Spec: /docs/registry/wallets.md
// Called by identity.provisionWalletIfMissing post-CMA/MJA.

import { prisma } from '../db';

export type WalletErrorCode = "MAGIC_PROVISIONING_FAILED";

export type WalletResult =
    | { ok: true; wallet_address: string }
    | { ok: false; error_code: WalletErrorCode; message: string };

// Provisions a Solana keypair via Magic silent provisioning; persists
// publicAddress to users.wallet_address. Idempotent on existing wallet.
export async function provisionForUser(user_id: string): Promise<WalletResult> {
    const user = await prisma.user.findUnique({
        where: { user_id },
        select: { wallet_address: true },
    });
    if (user?.wallet_address) {
        return { ok: true, wallet_address: user.wallet_address };
    }
    // TODO: @magic-sdk/admin -- Magic silent wallet provisioning per R71 §3.3
    // TODO: const { publicAddress } = await magic.silent.createWallet(...)
    // TODO: await prisma.user.update({ where: { user_id }, data: { wallet_address: publicAddress } })
    return {
        ok: false,
        error_code: "MAGIC_PROVISIONING_FAILED",
        message: "Magic admin SDK not yet wired (TBD in package.json).",
    };
}
