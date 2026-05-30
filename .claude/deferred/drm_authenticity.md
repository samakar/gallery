# DRM Content Authenticity Gate

Day-1 hard requirement. Prevents authenticated-fake-image fraud. C2PA manifest validation overlaps image_spec §2.8; this module extends it with synthetic-content detection, deepfake-of-real-person check, origin-declaration enforcement, and reverse-image pre-check.

## 1. Interface

### 1.1 Inputs

#### file

#### upload_id

#### creator_id

#### origin_declaration
Enum: Captured, Hand-produced, AI-assisted, AI-generated. Required.

#### ai_tool_disclosure (optional)
List of generative tools / models used. Required iff origin_declaration in {AI-assisted, AI-generated}.

#### deepfake_resolution_evidence (optional)
Present on resubmission after deepfake gate; one of: consent_document (hash + signing_event_id), synthetic_disclosure (depicted_person_name + jurisdictional basis), creator_as_subject (computed).

#### phash (optional)
Pre-computed by drm_uniqueness; reused for reverse-image pre-check.

### 1.2 Outputs

#### Pass

| Field | Type | Notes |
|---|---|---|
| ok | bool | true |
| c2pa_present | bool | manifest detected |
| c2pa_action_chain | string[] | from image_spec §2.8 |
| tier1_forensics | object | ELA / PRNU / quant-table summary |
| tier2_confidence | enum | high, medium, low |
| origin_declaration | enum | echoed |
| origin_badge | string | "Captured" / "Hand-produced" / "AI-assisted" / "AI-generated" |
| deepfake_detected | bool | |
| deepfake_resolution_path | enum or null | consent_document, synthetic_disclosure, creator_as_subject, or null |
| reverse_image_hits | object[] | URL + corpus_match flag per hit |

#### Reject

| Field | Type | Notes |
|---|---|---|
| ok | bool | false |
| error_code | enum | one of §1.3 |
| evidence | object | classifier scores or face-match details |

#### Gate

| Field | Type | Notes |
|---|---|---|
| ok | bool | false |
| error_code | enum | DEEPFAKE_GATED or REVERSE_IMAGE_REVIEW |
| permitted_resolution_paths | string[] | for DEEPFAKE_GATED |
| review_ticket_id | string or null | for REVERSE_IMAGE_REVIEW |

### 1.3 Error Codes

| Code | Trigger |
|---|---|
| ORIGIN_DECLARATION_MISMATCH | Tier 2 contradicts origin_declaration at high confidence |
| UNDISCLOSED_SYNTHETIC | Tier 2 high-confidence synthetic, origin_declaration in {Captured, Hand-produced} |
| DEEPFAKE_GATED | public-figure match detected, no valid deepfake_resolution_evidence |
| DEEPFAKE_RESOLUTION_INVALID | resolution_evidence supplied but validation failed |
| REVERSE_IMAGE_REVIEW | reverse-image hit outside creator's verified-portfolio corpus; §7.1.7 handoff |
| AUTHENTICITY_CLASSIFIER_UNAVAILABLE | Tier 2 or deepfake index failure; fail-closed |

### 1.4 Pre / Post Conditions

| Type | Condition |
|---|---|
| Pre | file passed drm_csam, drm_aicsam, drm_ncii, drm_adult; origin_declaration supplied |
| Pre (C2PA fields) | image_spec §2.8 has validated manifest signature where present |
| Post (pass) | classifier scores, c2pa_action_chain, origin_badge persisted to deed metadata |
| Post (reject) | upload terminated; origin-warranty breach logged on ORIGIN_DECLARATION_MISMATCH / UNDISCLOSED_SYNTHETIC |
| Post (gate DEEPFAKE_GATED) | resubmission permitted with evidence |
| Post (gate REVERSE_IMAGE_REVIEW) | §7.1.7 ticket created |
| Post (always) | no facial-image bytes retained (BIPA compliance) |

### 1.5 Acceptance Criteria

| ID | Given | When | Then |
|---|---|---|---|
| AC-01 | clean photo, origin=Captured, Tier 2 high | gate runs | ok=true; origin_badge="Captured" |
| AC-02 | clearly AI-generated, origin=Captured | gate runs | error_code=ORIGIN_DECLARATION_MISMATCH |
| AC-03 | synthetic image, origin=Hand-produced, Tier 2 high-synthetic | gate runs | error_code=UNDISCLOSED_SYNTHETIC |
| AC-04 | public-figure face detected, no evidence | gate runs | error_code=DEEPFAKE_GATED |
| AC-05 | public-figure face detected, valid consent_document | gate runs with evidence | ok=true; deepfake_resolution_path=consent_document |
| AC-06 | reverse-image hit on creator's verified domain | gate runs | ok=true; reverse_image_hits includes hit with corpus_match=true |
| AC-07 | reverse-image hit outside corpus | gate runs | error_code=REVERSE_IMAGE_REVIEW |
| AC-08 | Tier 2 classifier 503 | gate runs | error_code=AUTHENTICITY_CLASSIFIER_UNAVAILABLE |

## 2. Functional Requirements

### 2.1 Capture-Attestation Track
For files carrying a C2PA manifest, surface the chain on the deed:

| Field | Source | Surface |
|---|---|---|
| Capture device | Camera-signed C2PA manifest | "Captured with [device]" badge |
| Capture timestamp | Camera-signed manifest | Provenance timeline |
| Edit history | `c2pa.actions` chain | "Edit history" panel |
| Generative-AI flag | `c2pa.actions` generative entries | "AI-generation: [yes/no/partial]" badge |

C2PA manifest presence is informational at the default tier (not mandatory). Validation of signature and integrity is delegated to image_spec §2.8.

### 2.2 Synthetic-Content Detection

| Tier | Method | Detects |
|---|---|---|
| Tier 1: Pixel-level forensics | Error-level analysis; JPEG-quantization-table consistency; sensor-noise (PRNU) | Region tampering, recompression-laundering of AI images |
| Tier 2: Generative-model fingerprints | Diffusion-model artifact classifier + GAN-fingerprint detector (Sensity-class API or self-hosted) | Whole-image generation, face-swap composites |

Tier 2 emits authenticity_confidence in {high, medium, low}, recorded in deed metadata.

### 2.3 Deepfake-of-Real-Person Check
Run face-recognition against the public-figure index (shared with drm_rop where operationally feasible). On match, gate until one of:

1. Written consent from depicted person, hash-bound to deed, OR
2. Synthetic-depiction disclosure with depicted-person name plus "not the actual person" label on deed page (where consent terms or jurisdictional law permit), OR
3. Creator-as-subject via R62 §3.1 face-match.

Without resolution -> DEEPFAKE_GATED.

### 2.4 Origin Declaration
Creator declares one of four values at mint:

| Declaration | Acceptance criteria |
|---|---|
| Captured | C2PA verified where present; Tier 2 = high; "Captured" badge on deed |
| Hand-produced | Tier 2 = high or medium; "Hand-produced" badge |
| AI-assisted | Tier 2 results recorded; "AI-assisted" badge + tool disclosure |
| AI-generated | Tier 2 results recorded; "AI-generated" badge + model disclosure |

False declaration (Tier 2 contradicts at high confidence) -> origin-warranty breach; graduated penalties.

### 2.5 Reverse-Image Pre-Check
Use pHash from drm_uniqueness §2.1 to query major public image indices (web image search, public stock-photo databases). Hits inside the creator's verified-portfolio corpus (R62 §3.1 Creator Portfolio Verification) pass with informational disclosure. Hits outside the corpus -> handoff to §7.1.7 Provenance and Rights Verification (downstream; not MVP scope).

### 2.6 Tier-Graduated Enforcement
Default tier (MVP): all four origin declarations acceptable; deepfake check gating; synthetic detection informational + reject on undisclosed synthetic. Photographer-verified and journalistic tiers are forward-looking (R66 §6.1 Year 2-3+); not in scope.

## 3. Architecture

### 3.1 Pipeline
1. C2PA manifest fields harvested for surfacing (validation delegated to image_spec §2.8).
2. Tier 1 pixel-forensics run.
3. Tier 2 generative-fingerprint classifier run.
4. Deepfake-of-real-person face-recognition run (shares public-figure index with drm_rop).
5. Origin-declaration evaluated against Tier 2 result.
6. Reverse-image pre-check (pHash handoff from drm_uniqueness).

Steps 2-4 run in parallel; step 5 is the gating decision; step 6 emits a routing signal (no gating decision in MVP).

## 4. Non-Functional Requirements

| Property | Specification |
|---|---|
| Tier 1 latency | <= 1 s p95 |
| Tier 2 latency | <= 3 s p95 |
| Deepfake check latency | <= 1.5 s p95 (shared index with drm_rop) |
| Availability | fail-closed for Tier 2 and deepfake check; Tier 1 and reverse-image best-effort |
| Determinism | bound to classifier_versions and index_versions |
| Audit | all classifier scores + decisions logged |

## 5. Dependencies

| Dependency | Role |
|---|---|
| image_spec §2.8 | C2PA manifest validation (signature, integrity, tool chain) |
| ELA / PRNU / quant-table forensics library | Tier 1 |
| Sensity-class API (or self-hosted diffusion-artifact + GAN-fingerprint classifier) | Tier 2 |
| PimEyes-class face-search API | deepfake-of-real-person index (shared with drm_rop) |
| drm_uniqueness | pHash handoff for reverse-image |
| Public image indices | reverse-image pre-check |

## 6. Open Issues

| ID | Issue |
|---|---|
| OI-01 | Tier 2 score-to-band thresholding (high / medium / low boundaries) |
| OI-02 | Disclosure-acceptable jurisdictions for §2.3 path 2 ("synthetic depiction" disclosure) |
| OI-03 | Reverse-image index coverage: which public sources beyond web image search and stock-photo DBs |
| OI-04 | C2PA action vocabulary scope: extension actions outside the standard set |
| OI-05 | Origin-declaration false-positive escalation: Tier 2 "AI" verdict on hand-produced digital painting at high confidence |
| OI-06 | §7.1.7 manual-review module out-of-scope MVP; reverse-image-out-of-corpus handling stub |
| OI-07 | Deepfake-index overlap with drm_rop public-figure index: shared infrastructure vs separate; ownership |

## 7. Cross-References

| Doc | Purpose |
|---|---|
| drm | parent subsystem |
| image_spec §2.8 | C2PA validation |
| drm_uniqueness | pHash handoff |
| drm_rop | shared public-figure index |
| c2pa | C2PA toolkit subsystem |
| card1_certify_wsd | calling workflow |
| R62 §7.1.4 | reference architecture |
| R67 Appendix F | C2PA ecosystem state |
| Constitution INV-07, INV-08 | identity-bound creator; append-only C2PA |

---
*Last Updated: 05/12/26 11:00*
