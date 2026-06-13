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
    | "CREATOR_NOT_ALLOWLISTED"
    | "ROLE_CONFLICT_USER_IS_BUYER"
    | "ROLE_CONFLICT_USER_IS_CREATOR";

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
// derive roles from creators/owners row existence + wallet provisioning + env
// moderator DID. R71 §3.7 row 1 (POST /v1/auth/session) + middleware on every
// authed route.
//
// Role derivation (single source of truth):
//   is_creator   = (creators row exists for user_id) AND (users.wallet_address NOT NULL)
//   is_owner     = (owners row exists for user_id)   AND (users.wallet_address NOT NULL)
//   is_moderator = (users.magic_did == process.env.FOUNDER_MAGIC_DID)
//
// The wallet requirement on is_creator / is_owner aligns the flag with the
// post-onboarding state observable to the user -- creator_onboarding_wsd.md
// step 8 (dashboard renders) is the first request where is_creator reads true;
// step 6 (sign-cma) commits the creators row + step 7 (wallet provisioning)
// runs in the same HTTP request, so both side-effects land together and the
// next verifyDidToken call sees the flag flip.
export async function verifyDidToken(token: string): Promise<IdentityResult<AuthenticatedPrincipal>> {
    // TODO: magic.token.validate(token); magic.token.getIssuer(token) -> magic_did
    // TODO: prisma.users.upsert by magic_did; load oauth_provider + email from claim
    // TODO: derive roles per the formula above
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

// MVP single-role exclusivity (identity.md §2.3). At MVP a `users` row carries
// at most ONE of `creator` or `owner`. Dual-role is a planned future feature
// (OI-04b); when it lands, callers can drop these guards without schema change.
export async function assertNoOwnerRole(user_id: string): Promise<IdentityResult<true>> {
    const has = await prisma.owner.findUnique({ where: { user_id }, select: { user_id: true } });
    return has
        ? { ok: false, error_code: "ROLE_CONFLICT_USER_IS_BUYER", message: `User ${user_id} already has an owner role; dual-role is post-MVP.` }
        : { ok: true, value: true };
}

export async function assertNoCreatorRole(user_id: string): Promise<IdentityResult<true>> {
    const has = await prisma.creator.findUnique({ where: { user_id }, select: { user_id: true } });
    return has
        ? { ok: false, error_code: "ROLE_CONFLICT_USER_IS_CREATOR", message: `User ${user_id} already has a creator role; dual-role is post-MVP.` }
        : { ok: true, value: true };
}

// Launch-phase gate for POST /v1/creator/sign-cma (identity.md §2.4). When
// CREATOR_ALLOWLIST_ENABLED is not "true" the gate is inert. When enabled,
// CREATOR_ALLOWLIST_EMAILS is a comma-separated list; whitespace and case are
// normalized before comparison.
export async function assertCreatorAllowlisted(email: string): Promise<IdentityResult<true>> {
    if (process.env.CREATOR_ALLOWLIST_ENABLED !== "true") {
        return { ok: true, value: true };
    }
    const allowed = (process.env.CREATOR_ALLOWLIST_EMAILS ?? "")
        .split(",")
        .map(s => s.trim().toLowerCase())
        .filter(s => s.length > 0);
    return allowed.includes(email.trim().toLowerCase())
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
