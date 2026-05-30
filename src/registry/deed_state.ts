// deed_state.ts
// Mirror of on-chain deed_state field.
// Spec: /docs/registry/deed_state.md
//
// MVP: all deeds are 'sealed' (no Master download surface, no multi-sig
// adjudication active). Forward-compat enum exists for opened, rights_disputed,
// void, burned -- transitions to the latter three require 3-of-5 multi-sig
// per INV-06 (MMP only).

import { prisma } from '../db';

export type DeedState =
    | "sealed"
    | "opened"
    | "rights_disputed"
    | "void"
    | "burned";

export type DeedStateErrorCode = "DEED_NOT_FOUND";

export type DeedStateResult =
    | { ok: true; deed_state: DeedState }
    | { ok: false; error_code: DeedStateErrorCode; message: string };

// Pure read at MVP. Solana ledger is authoritative; this row is a mirror.
export async function getDeedState(mint_address: string): Promise<DeedStateResult> {
    const deed = await prisma.deed.findUnique({
        where: { mint_address },
        select: { deed_state: true },
    });
    if (!deed) {
        return {
            ok: false,
            error_code: "DEED_NOT_FOUND",
            message: `No deed for mint ${mint_address}.`,
        };
    }
    return { ok: true, deed_state: deed.deed_state as DeedState };
}

// MMP only: deed_state mutations require 3-of-5 multi-sig per INV-06.
// Not exported until activation. Reference signature:
//   export async function transitionTo(
//       mint_address: string,
//       new_state: DeedState,
//       multi_sig_proof: MultiSigProof
//   ): Promise<{ ok: boolean }>
