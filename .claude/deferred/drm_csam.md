# DRM CSAM Hash-Match Gate (Tier 0)

> **DEFERRED to post-MVP per revised R71.** MVP supersedes automated PhotoDNA hash-matching with a moderator manual two-checkbox review per R71 §2.2 step 5 -- see [moderation](../cert/moderation.md). The §2.3 ordering cited below ("Tier 0 runs before drm_adult") and the §2.4 immunity anchor no longer resolve in R71; R71 §2.2 step 5 is now the moderator review, not PhotoDNA. Retained unchanged for MMP re-activation. Constitution: 18 U.S.C. §2258A reporting obligation passes through to the moderator-review NCMEC subflow at MVP.

Hard floor. Runs synchronously before any other ingestion gate. Non-skippable. Operates under 18 U.S.C. §2258B good-faith immunity.

## 1. Interface

### 1.1 Inputs

#### file
Binary image data. Has already passed image_spec (JPEG only per R71 §1.3).

#### upload_id
Opaque ingestion token.

#### creator_id
Verified creator identifier.

### 1.2 Outputs

#### Pass

| Field | Type | Notes |
|---|---|---|
| ok | bool | true |
| api_version | string | PhotoDNA model version queried |

#### Reject

| Field | Type | Notes |
|---|---|---|
| ok | bool | false |
| error_code | enum | one of §1.3 |
| ncmec_ticket_id | string or null | present iff CSAM_HASH_MATCH |

### 1.3 Error Codes

| Code | Trigger |
|---|---|
| CSAM_HASH_MATCH | PhotoDNA or Tech Coalition corpus match |
| PHOTODNA_UNAVAILABLE | API failure or timeout; gate fails closed |

Fixed taxonomy. Adding a code is a contract change.

### 1.4 Pre / Post Conditions

| Type | Condition |
|---|---|
| Pre | file has passed image_spec |
| Post (pass) | no metadata leakage beyond api_version |
| Post (reject CSAM) | account suspended; §2258A report queued; staging purged; LE referral logged |
| Post (reject unavailable) | ingestion halted; no downstream gate runs |
| Post (always) | call logged with file_hash + ts + result |

### 1.5 Acceptance Criteria

| ID | Given | When | Then |
|---|---|---|---|
| AC-01 | clean JPEG | Tier 0 runs | ok=true; downstream gates proceed |
| AC-02 | file matches known-CSAM hash | Tier 0 runs | error_code=CSAM_HASH_MATCH; §2258A queued; account suspended |
| AC-03 | PhotoDNA returns 503 | Tier 0 runs | error_code=PHOTODNA_UNAVAILABLE; ingestion halts |

## 2. Functional Requirements

### 2.1 Hash-Match
Compute PhotoDNA hash of file; query against NCMEC CyberTipline known-CSAM index plus Tech Coalition hash-sharing corpus. Match per PhotoDNA threshold -> CSAM_HASH_MATCH.

### 2.2 On Detection
Synchronous sequence; each step blocking the next:

| Step | Action |
|---|---|
| 1 | Hard reject; Master and derivatives purged from staging |
| 2 | Creator account suspended pending investigation |
| 3 | 18 U.S.C. §2258A NCMEC CyberTipline report filed; target SLA 24h, statutory ceiling 60 days |
| 4 | LE referral per standard procedure |
| 5 | Permanent platform removal; royalty streams forfeit |

### 2.3 Ordering
Tier 0 runs before drm_adult. No downstream gate sees a file Tier 0 has not cleared. (Pre-R71 gates -- aicsam, ncii, rop, uniqueness, authenticity, malware -- deferred to /docs/deferred/.)

### 2.4 Good-Faith Immunity
Operates under 18 U.S.C. §2258B. Retention scoped to LE compliance; no other use.

## 3. Non-Functional Requirements

| Property | Specification |
|---|---|
| Latency | <= 500 ms p95 per hash-match |
| Availability | fail-closed: on PhotoDNA unavailability ingestion halts; no fail-open path |
| Audit | every call logged (file_hash, ts, result, api_version) |
| Determinism | identical bytes -> identical decision (modulo PhotoDNA model version) |

## 4. Dependencies

| Dependency | Role |
|---|---|
| Microsoft PhotoDNA API | hash compute + index lookup |
| Tech Coalition hash-sharing infrastructure | additional known-CSAM corpus |
| NCMEC CyberTipline | report submission |

## 5. Open Issues

| ID | Issue |
|---|---|
| OI-01 | PhotoDNA fail-closed behavior: bounded retry queue vs immediate hard-stop |
| OI-02 | Evidence retention for matched files handed to LE; scope and duration |
| OI-03 | PhotoDNA model-version bump replay policy: re-scan archived Masters or accept point-in-time match only |

## 6. Cross-References

| Doc | Purpose |
|---|---|
| drm | parent subsystem |
| image_spec | upstream technical-quality gate |
| drm_adult | downstream content classification gate |
| R71 §2.2 step 5 | MVP spec |
| R62 §7.1.6 Tier 0 | reference architecture |
| R67 §5.12 | legal foundation |
| Constitution INV-03 | determinism |

---
*Last Updated: 05/13/26 09:00*
