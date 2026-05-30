// identity.ts
// MVP identity: Magic DID verification, row-existence role grants, creator
// allowlist, wallet-provisioning trigger.
// Spec: /docs/cert/identity.md
//
// User login = Magic SDK OAuth (Google / Apple). Sessions are DID-token-stateless.
// The wallet primitive is Registry-owned per INV-4; this module triggers
// provisioning post-ESIGN but does not own the keypair.

import { prisma } from '../db';

export type IdentityErrorCode =
    | "MAGIC_DID_INVALID"
    | "ROLE_REQUIRED"
    | "CREATOR_NOT_ALLOWLISTED";

export type Role = "creator" | "owner" | "moderator";

export interface AuthenticatedPrincipal {
    user_id: string;
    magic_did: string;
    email: string;
    oauth_provider: "google" | "apple";
    wallet_address: string | null;     // null until post-ESIGN wallet provisioning
    roles: { is_creator: boolean; is_owner: boolean; is_moderator: boolean };
}

export type IdentityResult<T> =
    | { ok: true; value: T }
    | { ok: false; error_code: IdentityErrorCode; message: string };

// Verify DID token from `Authorization: Bearer <token>`; upsert users row;
// derive roles from creators/owners row existence + env-config moderator DID.
// R71 §3.7 row 1 (POST /v1/auth/session) + middleware on every authed route.
export async function verifyDidToken(token: string): Promise<IdentityResult<AuthenticatedPrincipal>> {
    // TODO: magic.token.validate(token); magic.token.getIssuer(token) -> magic_did
    // TODO: prisma.users.upsert by magic_did; load oauth_provider + email from claim
    // TODO: derive roles from creators/owners row existence + env FOUNDER_MAGIC_DID
    return { ok: false, error_code: "MAGIC_DID_INVALID", message: "TODO" };
}

// Pure role guard on the resolved principal.
export function requireRole(p: AuthenticatedPrincipal, role: Role): IdentityResult<true> {
    const has = role === "creator" ? p.roles.is_creator
              : role === "owner" ? p.roles.is_owner
              : p.roles.is_moderator;
    return has
        ? { ok: true, value: true }
        : { ok: false, error_code: "ROLE_REQUIRED", message: `Role ${role} required.` };
}

// Hard precondition for POST /v1/creator/sign-cma (R71 §3.7 row 4).
export async function assertCreatorAllowlisted(email: string): Promise<IdentityResult<true>> {
    const hit = await prisma.creatorAllowlist.findUnique({ where: { email } });
    return hit
        ? { ok: true, value: true }
        : { ok: false, error_code: "CREATOR_NOT_ALLOWLISTED", message: `Email ${email} not on creator allowlist.` };
}

// Triggered by esign after CMA / MJA capture (INV-2 ordering). Idempotent on
// users.wallet_address. The wallet primitive is Registry-owned per INV-4 --
// identity reads existing wallets here, but first-time creation is delegated
// to the Registry wallets subsystem (Magic silent provisioning per R71 §3.3).
export async function provisionWalletIfMissing(user_id: string): Promise<string> {
    const user = await prisma.user.findUnique({
        where: { user_id },
        select: { wallet_address: true },
    });
    if (user?.wallet_address) return user.wallet_address;
    // TODO: registry/wallets.provisionForUser(user_id) -> publicAddress
    //       (Magic silent provisioning per R71 §3.3; wallets subsystem per INV-4)
    // TODO: prisma.user.update({ where: { user_id }, data: { wallet_address: publicAddress } })
    throw new Error('Wallet creation depends on Registry wallets subsystem (TBD per INV-4).');
}
