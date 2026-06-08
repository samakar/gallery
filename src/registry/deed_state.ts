// deed_state.ts
// Mirror of the on-chain deed state, modeled as two orthogonal state machines
// per deed.md §2.3:
//
//   custody_state machine:
//      draft ──> sealed ──> unsealed
//                  │            │
//                  └────────────┴──> burned (terminal)
//
//      Transitions:
//        draft → sealed       = applyMintSucceeded (synthetic 'draft' is API-only)
//        sealed → unsealed    = first /download-master (D-18 seal-break)
//        sealed → burned      = voluntary owner-burn OR sweeper after
//                                  legal_state='void' + per-reason grace expires
//        unsealed → burned    = same triggers as sealed → burned
//
//   legal_state machine:
//      legit ──> disputed ──> legit       (counter-notice prevails)
//                   │
//                   └──────> void          (adjudicated against; terminal)
//
//      Transitions:
//        legit → disputed     = takedown notice / report (any reason)
//        disputed → legit     = 3-of-5 multi-sig overturns
//        disputed → void      = 3-of-5 multi-sig upholds; refund issued;
//                                  per-reason compliance hold timer starts
//
//   Invariant: custody_state='burned' AND legal_state='disputed' is never valid.
//   Enforced at the multi-sig admin tool boundary.
//
// Voluntary owner-burn (per cma.md §8.X): owner signs a deterministic challenge
// with their wallet; custody_state → burned; legal_state stays 'legit'. No
// adjudication, no multi-sig, no refund.

import { prisma } from '../db';

export type CustodyState =
    | "sealed"
    | "unsealed"
    | "burned";

export type LegalState =
    | "legit"
    | "disputed"
    | "void";

export interface DeedStatePair {
    custody_state: CustodyState;
    legal_state: LegalState;
}

export type DeedStateErrorCode = "DEED_NOT_FOUND";

export type DeedStateResult =
    | { ok: true; states: DeedStatePair }
    | { ok: false; error_code: DeedStateErrorCode; message: string };

// Pure read at MVP. Solana ledger is authoritative; this row is a mirror.
export async function getDeedState(asset_id: string): Promise<DeedStateResult> {
    const deed = await prisma.deed.findUnique({
        where: { asset_id },
        select: { custody_state: true, legal_state: true },
    });
    if (!deed) {
        return {
            ok: false,
            error_code: "DEED_NOT_FOUND",
            message: `No deed for asset ${asset_id}.`,
        };
    }
    return {
        ok: true,
        states: {
            custody_state: deed.custody_state as CustodyState,
            legal_state: deed.legal_state as LegalState,
        },
    };
}

// Authorization helper: should the platform serve the Master to the deed-holder?
// Custody must allow it (sealed or unsealed; burned means destroyed).
// Legal must allow it (legit; not in dispute and not voided).
export function canServeMaster(states: DeedStatePair): boolean {
    return (
        (states.custody_state === "sealed" || states.custody_state === "unsealed") &&
        states.legal_state === "legit"
    );
}

// MMP only: state mutations on either axis require 3-of-5 multi-sig per INV-06,
// EXCEPT (a) sealed → unsealed (buyer-driven via /download-master) and
// (b) sealed/unsealed → burned via owner-voluntary-burn (owner wallet signature
// substitutes for multi-sig). Not exported until activation. Reference shape:
//   export async function transitionCustody(asset_id, new_state, auth);
//   export async function transitionLegal(asset_id, new_state, multi_sig_proof);
