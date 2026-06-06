# Legal documents

**DEMO CONTRACTS ONLY. NOT LEGAL ADVICE. NOT PRODUCTION-READY.**

These templates exist so the ESIGN click-wrap modals in the app have content to display and the signature capture pipeline has real `document_version_hash` values to commit to. **Every word must be reviewed and rewritten by your jurisdiction-appropriate attorney before production use.**

Each document is versioned by SHA-256 of its rendered text. The first line of every file is the canonical version label (e.g. `Version: 1.0-demo-2026-06-01`). When the text changes, bump the label; the hash will change automatically.

| File | Document type | When signed |
|---|---|---|
| `cma.md` | Creator Master Agreement | First creator onboarding (sign-cma) |
| `mja.md` | Master Joint Agreement | First buyer purchase (sign-mja) |
| `license_acceptance.md` | Per-image License Acceptance | Every purchase (sign-license) |
| `isa.md` | Image Signing Affirmation | Every creator upload (sign-isa, at Card 2) |
| `tos.md` | Terms of Service | Site-wide footer link |
| `privacy.md` | Privacy Policy | Site-wide footer link |

## Why these are insufficient for launch

- No state-by-state contract law tailoring
- No GDPR / CCPA / state-privacy-law specifics
- Arbitration and venue clauses are bare-bones placeholders
- DMCA safe-harbor language is incomplete
- No tax indemnification language
- No specific licensure terms for the underlying photographs (these are typically attorney-customized per platform)

Replace with attorney-drafted text before launch. The application code only requires:
- A title line
- A version label as the first markdown line
- Plain-text content that hashes deterministically
