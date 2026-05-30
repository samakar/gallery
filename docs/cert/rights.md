# Rights Subsystem

Rights / license configuration at MVP. The rights surface is mostly fixed: 10% creator royalty, single beneficiary, Unique edition only, per-image License Acceptance from one template (R71 §2.4 step 14). Operational enforcement is on-chain via the Metaplex Core royalty plugin at mint (onchain subsystem) and contractual via the License Acceptance ESIGN (esign subsystem). This module owns the MVP rights configuration and the License Acceptance text rendering -- not enforcement.

## 1. Interface

### 1.1 Inputs

#### getDeedRightsParams(image_id)
Returns the rights tuple to embed in deed metadata at mint dispatch.

#### renderLicenseAcceptanceText({ image_id, creator_display_name, listing_title })
Returns the rendered License Acceptance document text passed to esign.

### 1.2 Outputs

#### DeedRightsParams

| Field | Type | Value at MVP |
|---|---|---|
| royalty_pct | int | 10 |
| royalty_recipients | array | `[{ address: <creator.wallet_address>, share: 100 }]` |
| edition_tier | enum | `Unique` (only value at MVP) |

### 1.3 Error Codes

None at MVP -- pure computation over MVP constants + the `images` row's creator.

### 1.4 Pre / Post Conditions

| Type | Condition |
|---|---|
| Pre | `images` row exists; `creators` row exists; `creators.wallet_address` populated |
| Post | DeedRightsParams returned with fixed MVP values; License Acceptance text is deterministic for the (image, creator, title) triple |

### 1.5 Acceptance Criteria

| ID | Given | When | Then |
|---|---|---|---|
| AC-01 | image with creator wallet | `getDeedRightsParams(image_id)` | `{ royalty_pct: 10, royalty_recipients: [{ <creator>, 100 }], edition_tier: "Unique" }` |
| AC-02 | same (image, creator, title) | `renderLicenseAcceptanceText(...)` twice | byte-identical text |

## 2. Functional Requirements

### 2.1 Fixed MVP Configuration
- `royalty_pct = 10` (R71 §2.4 step 14: "flat MVP default; creator-configurable per-deed deferred to MMP alongside resale UI activation post-MVP")
- `royalty_recipients = {creator: 100%}` (single beneficiary)
- `edition_tier = Unique` (Limited / Unlimited tiers deferred to MMP per R71 §1)

### 2.2 License Acceptance Text Template
Per-image License Acceptance text template carrying field-of-use, territory, term, commercial-use permission, sublicensing rights, derivative-work rights, display permissions, and royalty terms (R62 §3.4). At MVP the template is fixed -- no per-image license parameter overrides. Personalization is the substitution of `{image_id, creator_display_name, listing_title}` only.

### 2.3 No Enforcement Here
- On-chain royalty enforcement on resale -> Metaplex Core royalty plugin (onchain subsystem) at deed mint
- Contractual rights binding -> License Acceptance ESIGN (esign subsystem) at purchase
- Takedown / rights-disputed mutation -> takedown subsystem (and 3-of-5 multi-sig per INV-06 -- MMP)

## 3. Non-Functional Requirements

| Property | Specification |
|---|---|
| Determinism | pure functions; no side effects |
| Latency | <= 1 ms (constant lookup + string interpolation) |

## 4. Dependencies

| Dependency | Role |
|---|---|
| `images` table | read-only; resolves the image to its creator |
| `creators` table | read-only; resolves `wallet_address` for royalty_recipients |
| esign | consumes `renderLicenseAcceptanceText` output as the document text to hash |
| onchain | consumes `DeedRightsParams` for the Crossmint mint metadata payload |

## 5. Open Issues

| ID | Issue |
|---|---|
| OI-01 | Creator-configurable royalty_pct at MMP (per-deed override) requires a `creator_royalty_pct` column on `images` or `creators` -- schema decision deferred |
| OI-02 | Limited / Unlimited edition tier activation at MMP: edition slot allocation (1/N, 2/N, ...) and provenance disclosure spec deferred |
| OI-03 | License Acceptance template versioning: where does the canonical template text live? Hardcoded constant at MVP; consider a `document_versions` table when esign OI-02 is addressed |
| OI-04 | Per-image license overrides (field of use, commercial-use permission per R62 §3.4): all fixed at MVP; the data model that would unlock this is post-MVP |

## 6. Cross-References

| Doc | Purpose |
|---|---|
| esign | consumes License Acceptance text |
| onchain (TBD) | consumes DeedRightsParams for Crossmint mint payload |
| R71 §2.4 step 14 | mint-time rights parameters (royalty_pct=10, royalty_recipients=creator, edition_tier=Unique) |
| R62 §3.3 Tier-Handling | full rights / tier framework (MMP) |
| R62 §3.4 Contract Architecture | License Acceptance terms |
| Constitution INV-2 | License Acceptance ESIGN precedes mint |

---
*Last Updated: 05/27/26 18:00*
