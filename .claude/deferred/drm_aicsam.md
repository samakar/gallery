# DRM AI-CSAM Classifier Gate (Tier 1)

Covers AI-generated CSAM that is by construction absent from the Tier 0 known-hash index. Treated identically to real CSAM under the PROTECT Act and state AI-CSAM statutes.

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
| classifier_version | string | model build identifier |
| confidence | float | below threshold |

#### Reject

| Field | Type | Notes |
|---|---|---|
| ok | bool | false |
| error_code | enum | one of §1.3 |
| ncmec_ticket_id | string or null | present iff AI_CSAM_DETECTED |

### 1.3 Error Codes

| Code | Trigger |
|---|---|
| AI_CSAM_DETECTED | classifier confidence >= operating threshold |
| AICSAM_CLASSIFIER_UNAVAILABLE | classifier failure or timeout; fail-closed |

### 1.4 Pre / Post Conditions

| Type | Condition |
|---|---|
| Pre | file passed image_spec and drm_csam |
| Post (pass) | classifier_version + confidence logged |
| Post (reject AI_CSAM) | account suspended; §2258A queued; staging purged |
| Post (reject unavailable) | ingestion halted |
| Post (always) | call logged with file_hash + ts + classifier_version + confidence |

### 1.5 Acceptance Criteria

| ID | Given | When | Then |
|---|---|---|---|
| AC-01 | clean JPEG | Tier 1 runs | ok=true |
| AC-02 | classifier confidence >= threshold | Tier 1 runs | error_code=AI_CSAM_DETECTED; §2258A queued |
| AC-03 | classifier timeout | Tier 1 runs | error_code=AICSAM_CLASSIFIER_UNAVAILABLE; ingestion halts |

## 2. Functional Requirements

### 2.1 Classifier
Run Thorn Safer-class classifier (or self-hosted equivalent on Thorn's CSAM-detection model) over the file. Confidence above the operating threshold -> AI_CSAM_DETECTED.

### 2.2 On Detection
Same downstream sequence as Tier 0 (drm_csam §2.2):

| Step | Action |
|---|---|
| 1 | Hard reject; staging purged |
| 2 | Account suspended |
| 3 | §2258A NCMEC report filed (synthetic CSAM treated identically per PROTECT Act + state AI-CSAM statutes) |
| 4 | LE referral |
| 5 | Permanent platform removal; royalty forfeit |

### 2.3 Ordering
Runs after Tier 0 (drm_csam) passes; before drm_ncii, drm_adult, drm_rop, drm_authenticity, drm_uniqueness, drm_malware.

## 3. Non-Functional Requirements

| Property | Specification |
|---|---|
| Latency | <= 2 s p95 per file |
| Availability | fail-closed: classifier unavailability halts ingestion |
| Threshold | calibrated; conservative-toward-reject at the boundary |
| Audit | classifier_version, threshold, confidence logged per call |
| Determinism | bound to classifier_version; replay test compares within same version |

## 4. Dependencies

| Dependency | Role |
|---|---|
| Thorn Safer API (or self-hosted equivalent) | classification |
| NCMEC CyberTipline | report submission |

## 5. Open Issues

| ID | Issue |
|---|---|
| OI-01 | False-positive appeals: route, SLA, evidence handling (no human review of suspected CSAM by platform staff -- requires Thorn / NCMEC partner intermediary) |
| OI-02 | Self-hosted vs vendor: deployment posture and update cadence |
| OI-03 | Classifier-version bump: archived-Master re-scan policy |

## 6. Cross-References

| Doc | Purpose |
|---|---|
| drm_csam | Tier 0 sibling |
| drm | parent subsystem |
| card1_certify_wsd | calling workflow |
| R62 §7.1.6 Tier 1 | reference architecture |
| R67 §5.12 | legal foundation (PROTECT Act + state AI-CSAM) |
| Constitution INV-03 | determinism (within classifier_version) |

---
*Last Updated: 05/12/26 11:00*
