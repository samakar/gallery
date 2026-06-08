# Gallery (Elanoid)

Pipeline of six sequential cards on a per-asset journey:
  Pre-Journey Identity Verification
  -> Card 1 Certify -> Card 2 Image Creation -> Card 3 List
  -> Card 4 Purchase -> Card 5 Deed -> Card 6 Personalization
Post-journey: Path 1 View, Path 2 Share, Resale (post-30-day), Takedown Handler.

Cards are workflows (orchestrators). Subsystems are functional capabilities invoked by workflows: drm, identity, wallets, deed_state, storage, payments, onchain, email, observability, audit_log, takedown, esign, rights. (C2PA handling is the drm_c2pa module under cert/drm, deferred to MMP per revised R71.)

## Reading Order Per Task

1. The Invariants section of this file (INV-NN) -- non-negotiable constraints
2. /docs/sad.md -- system architecture overview
3. The SDD for the subsystem or workflow you are working in
4. The ICD for any subsystem your code consumes
5. /docs/R71_Gallery_MVP_Specification.md -- authoritative gallery spec
6. Other R-docs in /docs/ (R62 protocol, R67 design, R65 security) for "why" questions and historical context

## Doc Layout

```
/                                    repo root
  claude.md                          stays at root for Claude Code discovery (includes the Invariants list)
  src/                               code (mirrors docs by name)
  docs/                              all design docs
    sad.md
    R71_Gallery_MVP_Specification.md authoritative gallery spec
    R62_Gallery_Protocol.md          reference architecture (R-series, flat at docs root)
    R65_Gallery_Platform_Security.md
    R67_Gallery_Design.md
    adr/
      adr_NNNN_<slug>.md
    <subsystem>/                     one folder per subsystem; modules flat inside
      <subsystem>.md                 subsystem-level design (interface + internals)
      <subsystem>_<module>.md        module-level design (interface + internals)
    workflows/
      <workflow>_wsd.md              workflow sequence document
```

Naming: `<subsystem>_<module>.md`. Lowercase, underscored. Module is omitted for subsystem-level docs. Each design doc contains both the boundary contract (§ Interface) and the internal design (Functional Requirements, Architecture, NFRs, Dependencies) in one file.

Examples:
  /docs/cert/identity.md                      subsystem-level
  /docs/cert/image_spec.md                 module-level (image-specification ingestion-window gate)
  /docs/cert/moderation.md          module-level (manual two-checkbox review at MVP)
  /docs/cert/certify_wsd.md                   workflow sequence (function-scoped)

Note: cert/ is a flat function-grouping folder (Certification function). All subsystems live as flat files inside, named `<subsystem>.md` or `<subsystem>_<module>.md`. Deferred-to-MMP items live at /docs/deferred/.

## Code Layout (mirrors docs by name)

```
/src/
  <subsystem>/                       one folder per subsystem; modules flat as files
    <module>.ts                      or <module>/ if a module grows beyond one file
    index.ts                         subsystem public surface
  workflows/
    <workflow>/                      one folder per card / path
  app/
    api/                             HTTP routes; thin glue invoking workflows
    workers/                         background jobs invoking workflows
    config/
    secrets/
```

| Code path | Docs to read |
|---|---|
| /src/cert/ | /docs/cert/ (flat -- all Certification subsystems) |
| /src/cert/image_spec.ts | /docs/cert/image_spec.md |
| /src/cert/moderation.ts | /docs/cert/moderation.md |
| /src/deferred/ | /docs/deferred/ (MMP-deferred items) |
| /src/workflows/card1_certify/ | /docs/workflows/card1_certify_wsd.md plus the design docs of subsystems the workflow invokes (read the § Interface section for call surface) |

## Where New Code Goes

- Functional capability invoked by multiple workflows -> /src/<name>/
- New workflow orchestration -> /src/workflows/<name>/
- HTTP route or webhook handler -> /src/app/api/ (glue only; logic in workflow or subsystem)
- Background job -> /src/app/workers/
- Never put business logic in /src/app/. Glue only.

## Where New Docs Go

- New subsystem -> new folder /docs/<subsystem>/ with <subsystem>.md
- New module within a subsystem -> one new file <subsystem>_<module>.md in the existing folder
- New workflow -> one _wsd.md in /docs/workflows/
- Cross-cutting decision -> next ADR number in /docs/adr/

## Doc Style: AI-Optimized and Terse

All design docs and WSD files in this repo are written for Claude Code consumption, not human readability. Each design doc combines boundary contract (§ Interface) and internal design (Functional Requirements, Architecture, NFRs, Dependencies). When creating or updating any doc, follow:

| Rule | Apply |
|---|---|
| Section order: Interface first, then Functional Requirements, then Architecture (if any), then NFRs, Dependencies, Open Issues, Cross-References | Interface is the stable contract and the most common read; front-load it. FRs and Architecture follow for implementers |
| Interface section: Inputs -> Outputs -> Error Codes -> Pre/Post Conditions -> Acceptance Criteria | Fixed order within the Interface section |
| No SUMMARY section restating the doc | Title and one-line scope cover this |
| No design rationale prose unless implementation depends on it | One line at top if needed; otherwise skip |
| No consumer notes prose | Calling workflow doc tells consumer how to call |
| Functional requirements as one-line statements | Thresholds and rules in tables, not paragraphs |
| Error codes, pre/post conditions, NFRs, deps, open issues -> tables | Tabular for parser efficiency |
| Acceptance criteria as Given / When / Then table rows | Compact, testable |
| Open issues with OI-NN IDs | Flag ambiguities; never invent thresholds |
| Cross-references table at the bottom | Pin the doc into the graph |
| Last Updated timestamp at the bottom | YY/MM/DD HH:MM |
| No prose summary at the bottom either | Conclusions belong in analysis reports, not specs |

## Style Conventions

- Markdown; no em-dashes (use `--` in prose, `->` in tables / lists / headers)
- Surgical edits only; never rewrite a section not asked for
- Read SKILL.md before any file or code operation
- Output paths: /mnt/user-data/outputs/
- Source paths (read-only): /mnt/project/

## Invariants

Operative non-negotiable constraints. Every design doc, ADR, and implementation decision is bound by these. Changes to any INV-NN require an ADR explicitly naming the affected invariant.

- INV-01: The image is the asset. The deed is the receipt. Never invert.
- INV-02: Platform MUST NOT hold buyer private keys; Path 1 decryption uses buyer-signed challenge.
- INV-03: Ingestion gates MUST be deterministic. Client-side gates fully deterministic; server-side ML gates deterministic within classifier_version (replay-tested per build).
- INV-04: No pixel modification of the Master after ingestion; watermarks applied at render time. (MVP per R71: render-time watermarking is visible Cloudinary overlays only -- PREVIEW text, monogram, in-pixel URL text; the invisible / spectrographic watermark is deferred to MMP, see /docs/deferred/drm_spectrographic.md.)
- INV-05: 30-day post-purchase settlement period; no resale listing before.
- INV-06: Multi-sig 3-of-5 approval required for deed legal_state transitions (`legit → disputed`, `disputed → legit`, `disputed → void`). Custody-axis transitions: `sealed → unsealed` is buyer-driven via /download-master and needs no multi-sig; `sealed/unsealed → burned` is either sweeper-driven after `legal_state='void' + grace expires` (no multi-sig; adjudication decision was made at `disputed → void`) OR owner-driven voluntary burn (owner wallet signature substitutes for multi-sig; deed.md OI-17). Operative enforcement at MVP is the procedural admin tool described in /docs/registry/deed.md OI-03 (3-of-5 ops approvers each sign the operation payload off-chain via ed25519; HOT_OPS_KEY signs the on-chain `update_metadata_v1` or Bubblegum `burn` only after the threshold is met; signed approvals appended to a tamper-evident audit log). On-chain Squads multi-sig is NOT required by this invariant; the procedural workflow + signed log are the operative enforcement. Migration to on-chain Squads at scale is an ADR-gated amendment, not an architectural shortfall.
- INV-07: No anonymous mint; creator (3-layer) and buyer (card-verified) MUST be identity-bound.
- INV-08: C2PA manifest is append-only; nothing is rewritten or removed. (MVP per R71: no C2PA manifest is produced -- C2PA handling is deferred to MMP, see /docs/deferred/drm_c2pa.md; the invariant binds once manifests exist.)
- INV-09: Client-side ingestion validators MUST NOT make external network calls. Server-side gates (moderation, RoP, authenticity, malware) may call vetted external APIs.
- INV-10: deed_state transitions are total; any unspecified transition is a bug, not a default.

---
*Last Updated: 26/06/03 01:50*
