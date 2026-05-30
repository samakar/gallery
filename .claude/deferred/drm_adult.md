# DRM Content Classification Gate

> **DEFERRED to post-MVP per revised R71.** MVP supersedes automated Hive classification with a moderator manual two-checkbox review per R71 §2.2 step 5 -- see [moderation](../cert/moderation.md). The §2.2 step 6 anchor cited below predates the revision and no longer resolves (step 6 is now the creator ESIGN Image Signing Affirmation, not a Hive gate). Retained unchanged for MMP re-activation. The pre-R71 ensemble simplification note is historical context for the eventual re-activation.

Hive Moderation classifier gate. Hard reject on Suggestive or above per R71 §2.2 step 6 ("G / Suggestive / Adult / Prohibited tiering; hard reject on Suggestive or above"). Only G-rated content passes.

R71 simplifies the pre-R71 multi-classifier ensemble (Hive + Google SafeSearch + Rekognition) to single-classifier Hive. The pre-R71 Suggestive-with-restrictions disposition is replaced with hard reject.

## 1. Interface

### 1.1 Inputs

#### file
Binary image data. Has passed image_spec and drm_csam.

#### upload_id

#### creator_id

### 1.2 Outputs

#### Pass

| Field | Type | Notes |
|---|---|---|
| ok | bool | true |
| classification | enum | "G" (the only passing value) |
| classifier_version | string | Hive model build id |
| scores | object | adult / racy / violence raw signals |

#### Reject

| Field | Type | Notes |
|---|---|---|
| ok | bool | false |
| classification | enum | "Suggestive", "Adult", or "Prohibited" |
| error_code | enum | one of §1.3 |
| classifier_version | string | |
| scores | object | |
| review_ticket_id | string or null | present iff classification = "Prohibited" |

### 1.3 Error Codes

| Code | Trigger |
|---|---|
| CONTENT_REJECTED | classification in {Suggestive, Adult} |
| PROHIBITED_CONTENT_REJECTED | classification = Prohibited (violence-against-persons, exploitation indicators); manual review |
| HIVE_CLASSIFIER_UNAVAILABLE | API failure or timeout; fail-closed |

### 1.4 Pre / Post Conditions

| Type | Condition |
|---|---|
| Pre | file passed image_spec and drm_csam |
| Post (pass) | classifier_version + scores logged; deed metadata records classification = G |
| Post (reject CONTENT_REJECTED) | upload terminated; creator notified |
| Post (reject PROHIBITED) | manual review queue entry created; creator account flagged |
| Post (reject unavailable) | ingestion halted |
| Post (always) | scores + classifier_version logged |

### 1.5 Acceptance Criteria

| ID | Given | When | Then |
|---|---|---|---|
| AC-01 | G-rated image | gate runs | ok=true; classification=G |
| AC-02 | racy image (Hive "racy: Likely") | gate runs | error_code=CONTENT_REJECTED; classification=Suggestive |
| AC-03 | nudity (Hive "adult: Likely") | gate runs | error_code=CONTENT_REJECTED; classification=Adult |
| AC-04 | violence-against-persons | gate runs | error_code=PROHIBITED_CONTENT_REJECTED; manual review |
| AC-05 | Hive API 503 | gate runs | error_code=HIVE_CLASSIFIER_UNAVAILABLE; ingestion halts |

## 2. Functional Requirements

### 2.1 Classifier
Single classifier: Hive Moderation REST API. Returns four-value classification plus per-detector scores (adult, racy, violence). Detection threshold per R71: "hard reject on Suggestive or above".

| Hive signal | Maps to |
|---|---|
| All detectors "Very Unlikely" / "Unlikely" | G |
| Racy "Possible" / "Likely" without adult threshold | Suggestive |
| Adult "Likely" / "Very Likely" | Adult |
| Violence-against-persons, exploitation indicators | Prohibited |

### 2.2 Disposition

| Classification | Disposition |
|---|---|
| G | Pass; only passing classification |
| Suggestive | Hard reject (CONTENT_REJECTED) |
| Adult | Hard reject (CONTENT_REJECTED) |
| Prohibited | Hard reject + manual review (PROHIBITED_CONTENT_REJECTED) |

### 2.3 Ordering
Runs after drm_csam passes. Result recorded in deed metadata regardless of pass / fail downstream.

### 2.4 Coverage Note
Per R71 §2.2 step 6, creator contractual warranty (Image Signing Affirmation at upload + CMA at signup) covers NCII, right-of-publicity, deepfake / synthetic origin, and uniqueness obligations. Dedicated automated gates for those categories are deferred (see /docs/deferred/).

## 3. Non-Functional Requirements

| Property | Specification |
|---|---|
| Latency | <= 2 s p95 |
| Availability | fail-closed: classifier unavailability halts ingestion |
| Threshold | conservative-toward-reject at the Suggestive/G boundary |
| Audit | classifier_version + scores + classification logged per call |
| Determinism | bound to classifier_version (INV-03 ML clause) |

## 4. Dependencies

| Dependency | Role |
|---|---|
| Hive Moderation REST API | classification |
| Manual review queue | downstream routing for Prohibited |

## 5. Open Issues

| ID | Issue |
|---|---|
| OI-01 | Appeals process for false-positive CONTENT_REJECTED (art-context nudity, classical-art reproductions, medical imagery); operational owner + SLA |
| OI-02 | Manual review SLA for PROHIBITED tickets; routing to founder vs Trust & Safety partner |
| OI-03 | Post-ingestion re-run policy when Hive model updates: retroactive deed-metadata updates and re-classification |
| OI-04 | Multi-classifier ensemble (Google SafeSearch, Rekognition) reactivation criteria at MMP scale |

## 6. Cross-References

| Doc | Purpose |
|---|---|
| drm | parent subsystem |
| drm_csam | upstream hard-floor gate (PhotoDNA Tier 0) |
| image_spec | upstream technical-quality gate |
| R71 §2.2 step 6 | MVP spec (Hive Moderation + hard reject Suggestive+) |
| R62 §7.1.6 | reference architecture for tiered moderation pipeline |
| Constitution INV-03 | determinism (within classifier_version) |

---
*Last Updated: 05/13/26 09:00*
