# DRM Right-of-Publicity Gate

Day-1 hard requirement. Addresses NY Civil Rights Law §§ 50-51, California Civil Code § 3344, Restatement (Third) of Unfair Competition § 46, and post-ELVIS-Act state regimes. Operates in parallel with drm_authenticity (deepfake-of-real-person check covers the technical-authenticity layer; this gate covers the consent layer).

## 1. Interface

### 1.1 Inputs

#### file

#### upload_id

#### creator_id
Verified creator with three-layer identity chain bound (R62 §3.1).

#### resolution_evidence (optional)
Present on resubmission after initial gate; one of:

| Type | Fields |
|---|---|
| model_release | document_hash, depicted_person_legal_name, dob, signing_event_id, scope_of_grant, governing_law |
| editorial_declaration | document_hash, event_basis, date, location, category |
| creator_as_subject | (no fields; computed from creator identity chain) |

### 1.2 Outputs

#### Pass

| Field | Type | Notes |
|---|---|---|
| ok | bool | true |
| face_presence | bool | true iff any identifiable-person detected |
| public_figure_match | bool | true iff public-figure index hit |
| resolution_path | enum or null | model_release, editorial_declaration, creator_as_subject, or null if face_presence=false |
| deed_binding | object or null | document_hash + on-chain pointer iff resolution_path requires it |

#### Gate (resolution required)

| Field | Type | Notes |
|---|---|---|
| ok | bool | false |
| error_code | enum | one of §1.3 |
| permitted_resolution_paths | string[] | subset of {model_release, editorial_declaration, creator_as_subject} |

#### Reject

| Field | Type | Notes |
|---|---|---|
| ok | bool | false |
| error_code | enum | one of §1.3 |

### 1.3 Error Codes

| Code | Trigger |
|---|---|
| ROP_RESOLUTION_REQUIRED | face detected, no valid resolution_evidence supplied |
| ROP_RESOLUTION_INVALID | resolution_evidence supplied but failed validation (release scope insufficient, signature invalid, creator-as-subject match below threshold) |
| ROP_FACE_INDEX_UNAVAILABLE | index lookup failure; fail-closed |

### 1.4 Pre / Post Conditions

| Type | Condition |
|---|---|
| Pre | file passed drm_csam, drm_aicsam, drm_ncii |
| Pre (resolution_evidence) | well-formed per §1.1 schema; signed via esign where applicable |
| Post (pass) | deed_binding emitted iff resolution_path != null |
| Post (gate) | upload state = gated_rop; resubmission permitted with evidence |
| Post (reject) | account flag on detected false-consent (forged release) |
| Post (always) | match_score + decision logged; no facial-image bytes retained |

### 1.5 Acceptance Criteria

| ID | Given | When | Then |
|---|---|---|---|
| AC-01 | landscape image, no faces | gate runs | ok=true; face_presence=false; resolution_path=null |
| AC-02 | photo of creator; creator-identity face match passes | gate runs | ok=true; resolution_path=creator_as_subject |
| AC-03 | photo of unidentified person, no evidence | gate runs | error_code=ROP_RESOLUTION_REQUIRED; permitted_resolution_paths includes model_release |
| AC-04 | photo of public figure, valid model release supplied | gate runs with evidence | ok=true; resolution_path=model_release; deed_binding emitted |
| AC-05 | model release with insufficient scope-of-grant | gate runs with evidence | error_code=ROP_RESOLUTION_INVALID |
| AC-06 | face index 503 | gate runs | error_code=ROP_FACE_INDEX_UNAVAILABLE |

## 2. Functional Requirements

### 2.1 Detection

| Index | Coverage | Method |
|---|---|---|
| Public-figure index | Entertainers, politicians, executives, athletes, public-presence individuals (~150K-200K identities) | Face-embedding similarity against hashed embeddings (PimEyes-class API or self-hosted equivalent). No stored facial images (BIPA / SB-1001 compliance) |
| General-population face presence | Any identifiable-person depiction | RetinaFace / MTCNN binary classifier; presence-only, no identity match |

A hit in either index gates the upload until a resolution path satisfies.

### 2.2 Resolution Paths

| Path | Evidence | Disposition |
|---|---|---|
| Consent (Model Release) | Platform-template model release executed by depicted person under ESIGN per R67 §5.6: legal name, DOB, signature, date, scope of grant, governing law (Delaware default, depicted-person residence override where applicable). Hashed, on-chain pointer bound to deed | Pass |
| Editorial-Use Exemption | Written editorial-context declaration: newsworthy event or public-context basis, date, location, category. Hashed, deed-bound. Default tier triggers manual review; journalistic tier (R66 §6.1 Year 3+) supports full enforcement | Pass (default tier: pending review) |
| Creator-as-Subject | Face-match between depicted person and creator's three-layer identity chain (R62 §3.1) above calibrated threshold | Pass automatically |
| (none) | -- | Reject |

Bulk releases (multiple Masters from a single photoshoot) supported via shared model-release document hash referenced by multiple deeds.

### 2.3 Treatment by Origin Declaration
Independent of drm_authenticity origin declaration. Identifiable-person presence triggers the gate regardless of Captured / Hand-produced / AI-assisted / AI-generated origin. Synthetic depiction of a real person without consent fails this gate even when drm_authenticity passes.

### 2.4 Private-Figure Forward Scope
Private-figure consent infrastructure (opt-in likeness protection) is forward-looking; activated alongside adjacent-market expansion. Not in MVP.

### 2.5 Failure Mode and Penalties
False consent claims (forged model release) -> contractual warranty breach. Graduated penalties: warn -> permanent suspension -> permanent removal + royalty forfeit.

## 3. Non-Functional Requirements

| Property | Specification |
|---|---|
| Public-figure index latency | <= 1.5 s p95 |
| Face-presence detection latency | <= 500 ms p95 |
| Availability | fail-closed for index unavailability; manual queue entry on partial-availability |
| Biometric posture | hashed embeddings only; no facial-image storage (BIPA + SB-1001) |
| Audit | embedding_match_score (where applicable) + decision logged per call |
| Determinism | bound to index_version and detector_version |

## 4. Dependencies

| Dependency | Role |
|---|---|
| PimEyes-class face-search API (or self-hosted) | public-figure embedding lookup |
| RetinaFace / MTCNN (or current SOTA) | face presence detection |
| esign | model-release / editorial-declaration signing |
| storage | release / declaration document hashing + binding |
| auth + creator identity (R62 §3.1) | creator-as-subject face match |

## 5. Open Issues

| ID | Issue |
|---|---|
| OI-01 | Public-figure index coverage gaps: regional / niche public figures not in vendor index |
| OI-02 | Editorial-use manual review owner and SLA at default tier |
| OI-03 | Bulk-release UX: per-photoshoot release covering N Masters |
| OI-04 | Calibrated match thresholds: index-side similarity, creator-as-subject confidence |
| OI-05 | Cross-jurisdiction governing-law selection for model release where depicted person and creator residences differ |
| OI-06 | Group photographs: when does general-population face-presence gate trigger (crowd scene vs portrait) |

## 6. Cross-References

| Doc | Purpose |
|---|---|
| drm | parent subsystem |
| drm_authenticity | parallel admission gate (deepfake-of-real-person) |
| drm_ncii | parallel gate (intimate-imagery dimension) |
| esign | model-release signing |
| card1_certify_wsd | calling workflow |
| R62 §7.1.5 | reference architecture |
| R67 §5.11 | state-law RoP regime |
| Constitution INV-07 | identity-bound creator + buyer |

---
*Last Updated: 05/12/26 11:00*
