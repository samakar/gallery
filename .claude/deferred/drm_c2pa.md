# DRM C2PA Module

> **DEFERRED to post-MVP per revised R71.** R71 ships no C2PA: the ingestion gate is PhotoDNA + Hive only (§2.2 steps 5-6), embedded image-file metadata is out of scope (Appendix C), and the string "C2PA" does not appear anywhere in R71. The R71 §1.1 / §2.2 step 5 / §2.2 step 8 / §3.1 anchors cited below predate the revision and no longer resolve (step 5 is now PhotoDNA, step 8 is image-id assignment + Original encryption). Retained unchanged for MMP. Constitution tension: INV-08 (C2PA manifest append-only) has no manifest to operate on at MVP -- pending constitution reconciliation.

Coalition for Content Provenance and Authenticity manifest handling. Parses, verifies, signs, and append-extends C2PA L1 manifests embedded in image files (JPEG / TIFF). Single platform-managed surface for all C2PA operations per R71 §1.1 ("C2PA L1 manifest required server-side") and R71 §3.1 (Ingestion Service).

INV-08: C2PA manifest is append-only; nothing is rewritten or removed.

## 1. Interface

### 1.1 Inputs

#### parseAndVerify
Called by image_spec §2.8 at server-side ingestion.

| Field | Type | Notes |
|---|---|---|
| file | bytes | JPEG or TIFF with embedded C2PA manifest |

#### signManifest
Called after Creator spectrographic watermark embedding. Creates the platform-issued, creator-bound C2PA L1 manifest.

| Field | Type | Notes |
|---|---|---|
| file | bytes | watermarked Master (output of drm_spectrographic embedCreator) |
| creator_id | string | three-layer-identity-bound |
| master_id | string | platform-issued |
| watermark_action | object | `c2pa_action` descriptor from drm_spectrographic (§1.2) |
| signing_event_id | string | from esign subsystem (Image Signing Affirmation per R71 §2.2 step 8) |

#### appendAction
Called whenever a downstream stage extends the manifest (deed mint, personalization, watermark layer).

| Field | Type | Notes |
|---|---|---|
| file | bytes | image with existing manifest |
| action | object | C2PA action assertion to append |

Action descriptor shape (per C2PA spec):

| Field | Type | Notes |
|---|---|---|
| action | string | one of §2.4 vocabulary (`c2pa.watermarked`, `c2pa.deed_issued`, `c2pa.personalized`, `c2pa.transcoded`) |
| parameters | object | action-specific fields |
| softBinding | object or null | optional Soft Binding Assertion (algorithm + binding value) per C2PA 2.4 |
| timestamp | string | ISO 8601 |

### 1.2 Outputs

#### parseAndVerify Result

| Field | Type | Notes |
|---|---|---|
| ok | bool | true if parse succeeded (manifest may still be invalid) |
| manifest_present | bool | manifest detected in file |
| signature_valid | bool | signature verifies against trust list (§2.5) |
| integrity_valid | bool | manifest hash matches embedded content |
| signer | string or null | signer identifier (from manifest certificate) |
| tool_chain | string[] | claim_generator strings |
| action_chain | object[] | parsed action assertions (in chain order) |
| ai_detected | bool | generative-AI generator in tool_chain or `c2pa.ai.generated` action present |

#### signManifest Pass

| Field | Type | Notes |
|---|---|---|
| ok | bool | true |
| signed_file | bytes | input with platform-signed manifest embedded |
| manifest_hash | string | SHA-256 of the manifest |
| signer_certificate | string | platform signing certificate fingerprint |

#### appendAction Pass

| Field | Type | Notes |
|---|---|---|
| ok | bool | true |
| signed_file | bytes | input with appended action and re-signed manifest |
| manifest_hash | string | SHA-256 of the updated manifest |
| action_index | int | position of the new action in the chain |

#### Reject (any operation)

| Field | Type | Notes |
|---|---|---|
| ok | bool | false |
| error_code | enum | one of §1.3 |
| message | string | human-readable |

### 1.3 Error Codes

| Code | Trigger |
|---|---|
| MISSING_C2PA | parseAndVerify: no manifest embedded |
| INVALID_C2PA_SIGNATURE | parseAndVerify: signature does not verify against trust list or manifest tampered |
| AI_GENERATED_CONTENT | parseAndVerify: generative-AI generator in tool_chain |
| MANIFEST_REWRITE_REJECTED | appendAction: attempt to modify an existing action (INV-08 violation) |
| INVALID_ACTION | appendAction: action descriptor fails schema validation |
| INVALID_SOFT_BINDING | appendAction: softBinding fields fail C2PA 2.4 Soft Binding API schema |
| SIGNER_KEY_UNAVAILABLE | signManifest / appendAction: platform signing key inaccessible |
| C2PA_TOOLKIT_UNAVAILABLE | toolkit infra error |

### 1.4 Pre / Post Conditions

| Type | Condition |
|---|---|
| Pre (parseAndVerify) | file is JPEG or TIFF |
| Pre (signManifest) | file has no existing platform manifest (signer must be unique per Master) |
| Pre (appendAction) | file has a valid existing manifest; action conforms to §2.4 vocabulary |
| Pre (always) | trust list and signing key loaded in memory at startup |
| Post (parseAndVerify) | input bytes unchanged; result describes manifest state |
| Post (signManifest) | output file contains exactly one platform manifest with the supplied creator binding |
| Post (appendAction) | manifest length grows by one action; prior actions byte-identical (INV-08) |
| Post (always) | operation logged with manifest_hash + signer + ts |
| Post (always) | no external network call; trust list local |

### 1.5 Acceptance Criteria

| ID | Given | When | Then |
|---|---|---|---|
| AC-01 | JPEG with valid camera-signed C2PA manifest (Sony, Leica, recent iPhone) | parseAndVerify | ok=true; signature_valid=true; tool_chain populated; ai_detected=false |
| AC-02 | JPEG with no manifest | parseAndVerify | error_code=MISSING_C2PA |
| AC-03 | JPEG with manifest signed by unrecognized signer | parseAndVerify | error_code=INVALID_C2PA_SIGNATURE |
| AC-04 | JPEG with manifest where `c2pa.actions` includes `c2pa.ai.generated` | parseAndVerify | ai_detected=true |
| AC-05 | watermarked Master file + valid creator_id + signing_event_id | signManifest | ok=true; signed_file contains platform manifest with `c2pa.created` + `c2pa.watermarked` actions and signing-event reference |
| AC-06 | file with valid platform manifest | appendAction({action: "c2pa.deed_issued", parameters: {deed_address}}) | ok=true; manifest length += 1; prior actions unchanged |
| AC-07 | appendAction descriptor rewriting an existing action index | appendAction | error_code=MANIFEST_REWRITE_REJECTED |
| AC-08 | appendAction with malformed softBinding | appendAction | error_code=INVALID_SOFT_BINDING |

## 2. Functional Requirements

### 2.1 Parse + Verify
Parse the C2PA manifest embedded in the file header. Verify:

| Check | Detail |
|---|---|
| Manifest present | Locate JUMBF / XMP / box-based manifest per C2PA spec |
| Signature | Cryptographically verify the manifest signature against the trust list (§2.5); fails on any tamper |
| Integrity | Manifest's declared content-hash matches the bound asset bytes |
| Tool-chain AI flag | Set ai_detected=true if any `claim_generator` entry maps to a known generative-AI tool, or if the action chain contains `c2pa.ai.generated` |

Returns structured manifest contents (signer, tool_chain, action_chain, integrity flags). Calling code interprets.

### 2.2 Sign Manifest (Platform-Issued, Creator-Bound)
Construct a new platform-issued C2PA L1 manifest binding the creator to the watermarked Master. Initial action chain at sign time:

| Action | Source |
|---|---|
| `c2pa.created` | Platform-issued creation marker (timestamp, creator_id, master_id) |
| `c2pa.watermarked` + Soft Binding Assertion | From drm_spectrographic embedCreator output (§1.1 watermark_action) |

The signing_event_id (from esign Image Signing Affirmation) is referenced as `c2pa.actions[].digitalSourceType` or similar evidence pointer so the ESIGN attestation travels with the file (R71 §2.2 step 8 chains into this).

Signed with the platform signing key. The platform certificate is published on the C2PA trust-list registry so external verifiers can validate.

### 2.3 Append Action
Append a new action assertion to the existing manifest's action chain. The manifest is re-signed with the platform key after append.

Append-only semantics (INV-08):
- New action lands at the end of the action chain
- Prior actions are byte-identical between pre- and post-append manifest payloads
- Attempts to rewrite or remove prior actions return MANIFEST_REWRITE_REJECTED

### 2.4 Action Vocabulary
Supported action assertions (per C2PA 2.4 spec + Elanoid extensions):

| Action | Emitted by | Parameters |
|---|---|---|
| `c2pa.created` | signManifest at ingestion | timestamp, creator_id, master_id |
| `c2pa.watermarked` | drm_spectrographic via signManifest (initial chain) or appendAction (Owner watermark at personalization) | softBinding.alg, softBinding.value, parameters.layer ("creator" or "owner") |
| `c2pa.transcoded` | format conversions (e.g., Cloudinary preview generation) | source_format, target_format |
| `c2pa.deed_issued` | onchain subsystem after Solana mint | deed_address, mint_tx_hash, mint_timestamp |
| `c2pa.personalized` | personalization workflow after monogram + Owner watermark + metadata layer | monogram_value, edition_number |

Soft Binding Assertion (per C2PA Soft Binding API 2.4) accompanies `c2pa.watermarked` actions with:

| Field | Convention |
|---|---|
| alg | algorithm identifier (e.g., `elanoid-stegastamp-v1`) |
| value | per-instance binding value (hex-encoded watermark payload bits) |

### 2.5 Trust List
In-memory list of accepted signing certificates loaded at startup. Updated via versioned rollout (configuration deployment, not runtime mutation). Trust list scope:

| Tier | Acceptable signers |
|---|---|
| Platform | Elanoid platform signing certificate (self-issued; published to C2PA registry) |
| Capture devices | Camera-OEM C2PA-registered signers (Sony, Leica, Nikon, recent iPhone, recent Pixel) |
| Editing tools | Adobe Content Credentials signer; other C2PA-registered editing platforms |

A manifest signed by a signer outside the trust list returns INVALID_C2PA_SIGNATURE. Capture devices and editing tools are recognized as authoritative for their respective action assertions; the platform signer is authoritative for `c2pa.created` (platform-issued masters), `c2pa.watermarked`, `c2pa.deed_issued`, and `c2pa.personalized`.

### 2.6 Append-Only Invariant (INV-08)
The manifest is append-only by construction. No public operation rewrites or removes a prior action. Tampering with prior actions invalidates the cryptographic chain and fails parseAndVerify's signature_valid check on every subsequent read.

### 2.7 No External Network
Per INV-09 (server-side scope), the drm_c2pa module operates with locally loaded trust list and signing key. No runtime API calls to external C2PA registries. Trust-list updates are configuration deployments, not online lookups.

## 3. Architecture

### 3.1 Toolkit
Built on [c2pa-node](https://github.com/contentauth/c2pa-rs) (Content Authenticity Initiative Node.js binding, wraps [c2pa-rs](https://github.com/contentauth/c2pa-rs) Rust core). The module wraps the toolkit with platform-specific concerns (trust list loading, signing-key management, append-only enforcement, action-vocabulary validation).

Development and test surfaces:

| CAI tool | Purpose in dev / test workflow |
|---|---|
| [c2patool](https://opensource.contentauthenticity.org/docs/c2patool/) | CLI for inspecting test fixtures, manually verifying signed outputs, generating replay-test corpus |
| [c2pa-attacks](https://github.com/contentauth/c2pa-attacks) | Security tool for manifest tamper testing (informs OI-06 tamper-test corpus) |

### 3.2 Signing Key Custody
Platform signing key managed by the secrets subsystem (HSM-backed in production; env-bound stub for dev). Key rotation policy: time-bounded certificate; renewal requires re-deployment; old certs remain in the trust list for verification of historical manifests.

## 4. Non-Functional Requirements

| Property | Specification |
|---|---|
| parseAndVerify latency | <= 150 ms p95 |
| signManifest latency | <= 250 ms p95 |
| appendAction latency | <= 200 ms p95 |
| External network | none at runtime (INV-09 server-side: trust list + key local) |
| Determinism | parseAndVerify deterministic; signManifest and appendAction deterministic modulo timestamp + signing counter |
| Audit | manifest_hash + operation + signer + ts logged per call |
| Append-only invariant | INV-08 enforced at every appendAction call; replay test asserts prior-actions byte-identity |

## 5. Dependencies

| Dependency | Role |
|---|---|
| [c2pa-node](https://github.com/contentauth/c2pa-rs) | manifest parse / verify / sign / append; Node.js binding over c2pa-rs (CAI canonical SDK) |
| C2PA trust list | static, versioned, loaded at startup (§2.5). Registration via [CAI Conformance Program](https://github.com/contentauth) |
| Platform signing certificate + private key | secrets-subsystem-managed |
| image_spec | upstream caller of parseAndVerify (§2.8 of image_spec) |
| drm_spectrographic | upstream emitter of `c2pa.watermarked` action descriptor (§2.9 of drm_spectrographic) |

No DB queries, no external APIs at runtime.

## 6. Open Issues

| ID | Issue |
|---|---|
| OI-01 | Trust list registration: Elanoid platform certificate registration via [CAI Conformance Program](https://github.com/contentauth); lead time vs MVP launch |
| OI-02 | Signing key HSM provisioning: AWS CloudHSM vs alternative; cost vs threat model at MVP volume |
| OI-03 | Soft-binding algorithm identifier registration with C2PA registry (drm_spectrographic OI-08 mirror) |
| OI-04 | Trust list scope for capture devices: which OEMs at launch (Sony / Leica / Apple only?) |
| OI-05 | Action vocabulary registration: `c2pa.deed_issued` and `c2pa.personalized` are Elanoid extensions; register or scope as platform-internal action namespace |
| OI-06 | Manifest size budget for action chain: practical limits before file overhead becomes user-visible; tamper-test corpus generated via [c2pa-attacks](https://github.com/contentauth/c2pa-attacks) |
| OI-07 | Certificate rotation policy: cadence, overlap window, historical-manifest verifiability under expired certs |

## 7. Cross-References

| Doc | Purpose |
|---|---|
| image_spec §2.8 | upstream caller of parseAndVerify |
| drm_spectrographic §2.9 | upstream emitter of `c2pa.watermarked` action descriptor |
| secrets | signing-key custody |
| takedown | downstream consumer of action chain for evidence |
| R71 §1.1 (C2PA L1 manifest required server-side) | MVP scope |
| R71 §2.2 step 5 (C2PA L1 manifest validation) | parseAndVerify call site |
| R71 §2.2 step 8 (Image Signing Affirmation) | signing_event_id reference incorporated into platform manifest |
| R71 §3.1 (Ingestion Service) | architectural placement |
| R62 §2.1 (Creator-bound C2PA manifest) | reference architecture |
| R62 §3.1 (creator identity binding) | identity-chain reference |
| [C2PA Technical Specification 2.4](https://spec.c2pa.org/specifications/specifications/2.4/specs/C2PA_Specification.html) | action assertion + manifest format |
| [C2PA Soft Binding API (2.4)](https://spec.c2pa.org/specifications/specifications/2.4/softbinding/Decoupled.html) | Soft Binding Assertion convention |
| [C2PA Implementation Guidance](https://spec.c2pa.org/specifications/specifications/1.0/guidance/Guidance.html) | toolkit + trust-list integration patterns |
| [c2pa-node + c2pa-rs (GitHub)](https://github.com/contentauth/c2pa-rs) | CAI canonical SDK; production runtime |
| [c2patool CLI](https://opensource.contentauthenticity.org/docs/c2patool/) | dev / test inspection + replay-test corpus |
| [c2pa-attacks](https://github.com/contentauth/c2pa-attacks) | manifest tamper-test corpus (OI-06) |
| [CAI Conformance Program](https://github.com/contentauth) | platform signer certificate registration (OI-01) |
| Constitution INV-07 | identity-bound creator + buyer |
| Constitution INV-08 | append-only manifest |
| Constitution INV-09 | no external network during validation (server-side: local trust list + key) |

---
*Last Updated: 05/13/26 13:00*
