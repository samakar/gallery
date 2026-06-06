# trash/

Files retired from the active codebase, preserved for reference until the next cleanup sweep.

## Contents

| Path | Why retired | When |
|---|---|---|
| `src/registry/crossmint_dispatch.ts` | Replaced by `src/registry/cnft_dispatch.ts` (Bubblegum V2 self-mint) per ADR-0008 | 2026-06-03 |
| `src/registry/crossmint_webhook.ts` | The self-mint dispatcher is synchronous; no webhook surface needed. The reusable post-mint helpers were extracted to `src/registry/post_mint.ts`. | 2026-06-03 |
| `src/registry/crossmint_lookup.ts` | Polling fallback removed; cNFT mints confirm synchronously, with the stale-paid sweeper handling retries per ADR-0007 | 2026-06-03 |
| `docs/registry/crossmint_dispatch.md` | Spec doc for the retired dispatcher; superseded by `docs/registry/cnft_dispatch.md` | 2026-06-03 |
| `docs/registry/crossmint_webhook.md` | Spec doc for the retired webhook | 2026-06-03 |
| `docs/registry/crossmint_lookup.md` | Spec doc for the retired lookup module | 2026-06-03 |

## What to do with this

Delete the folder once you're confident nothing in the active codebase references these files. Recommended verification before deletion:

- Grep the working tree for `crossmint_dispatch | crossmint_webhook | crossmint_lookup` -- should match only this folder and incidental mentions in docs (`divergences.md`, `mint_architecture.md`, `r62_r71_alignment.md`).
- Confirm the cNFT dispatcher (`src/registry/cnft_dispatch.ts`) and post-mint helpers (`src/registry/post_mint.ts`) handle every code path the retired files served.

See `/docs/divergences.md` D-14 and `/docs/registry/mint_architecture.md` §2 + OI-05 for the architectural context.
