# DRM NCII Classifier Gate (Tier 2)

Covers both real-photographic and synthetic NCII. Complements drm_rop (consent dimension) by addressing the intimate-imagery dimension.

## 1. Interface

### 1.1 Inputs

#### file
Binary image data. Has passed image_spec, drm_csam, drm_aicsam.

#### upload_id

#### creator_id

### 1.2 Outputs

#### Pass

| Field | Type | Notes |
|---|---|---|
| ok | bool | true |
| classifier_version | string | |
| confidence | float | below threshold |

#### Reject

| Field | Type | Notes |
|---|---|---|
| ok | bool | false |
| error_code | enum | one of §1.3 |
| takedown_ticket_id | string or null | present iff NCII_DETECTED |

### 1.3 Error Codes

| Code | Trigger |
|---|---|
| NCII_DETECTED | classifier confidence >= operating threshold |
| NCII_CLASSIFIER_UNAVAILABLE | classifier failure or timeout; fail-closed |

### 1.4 Pre / Post Conditions

| Type | Condition |
|---|---|
| Pre | file passed image_spec, drm_csam, drm_aicsam |
| Post (pass) | classifier_version + confidence logged |
| Post (reject NCII) | account suspended; Take It Down Act takedown queued; staging purged |
| Post (reject unavailable) | ingestion halted |

### 1.5 Acceptance Criteria

| ID | Given | When | Then |
|---|---|---|---|
| AC-01 | non-intimate image | Tier 2 runs | ok=true |
| AC-02 | classifier confidence >= threshold | Tier 2 runs | error_code=NCII_DETECTED; takedown queued |
| AC-03 | classifier 503 | Tier 2 runs | error_code=NCII_CLASSIFIER_UNAVAILABLE; ingestion halts |

## 2. Functional Requirements

### 2.1 Classifier
Run Hive Moderation NCII classifier (or self-hosted equivalent) over the file. Confidence above operating threshold -> NCII_DETECTED.

### 2.2 On Detection

| Step | Action |
|---|---|
| 1 | Hard reject; staging purged |
| 2 | Account suspended |
| 3 | Take It Down Act (2025) takedown procedure initiated |
| 4 | State-NCII-statute reporting where applicable |
| 5 | Permanent platform removal; royalty forfeit |

### 2.3 Ordering
Runs after drm_csam and drm_aicsam pass. Independent of drm_rop -- both run, both gate.

## 3. Non-Functional Requirements

| Property | Specification |
|---|---|
| Latency | <= 2 s p95 |
| Availability | fail-closed |
| Threshold | conservative-toward-reject at the boundary |
| Audit | classifier_version + confidence per call |
| Determinism | bound to classifier_version |

## 4. Dependencies

| Dependency | Role |
|---|---|
| Hive Moderation NCII API (or equivalent) | classification |
| Take It Down Act takedown infrastructure | downstream removal procedure |

## 5. Open Issues

| ID | Issue |
|---|---|
| OI-01 | Synthetic NCII vs drm_aicsam overlap when subject is minor: which gate's downstream sequence takes precedence (CSAM path) |
| OI-02 | State-NCII-statute reporting map: which states require reporting and to whom |
| OI-03 | Appeal route for false-positive (art-context, classical-art, medical) -- distinct from drm_adult appeals |

## 6. Cross-References

| Doc | Purpose |
|---|---|
| drm | parent subsystem |
| drm_rop | parallel admission gate (consent dimension) |
| card1_certify_wsd | calling workflow |
| R62 §7.1.6 Tier 2 | reference architecture |
| R67 §5.12 | legal foundation (Take It Down Act + state NCII) |

---
*Last Updated: 05/12/26 11:00*
