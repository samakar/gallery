# Image Spec Gate

Hard gate enforcing the R71 §1.3 image ingestion window. All downstream DRM modules presume their inputs have passed this gate.

Per revised R71 this gate is JPEG-only and dimension / quality-only. TIFF / PNG, 16-bit, color-profile, C2PA, AI-origin, and upscaling checks are out of MVP scope (TIFF / PNG / 16-bit per R71 Appendix C; C2PA + invisible watermark deferred to MMP; deepfake / synthetic-origin covered by creator contractual warranty per R71 §2.2 step 6).

## 1. Interface

### 1.1 Inputs

#### file
Binary image data. JPEG only. Format is asserted by the SOI magic bytes, not by extension or MIME (`File.type` is extension-derived and spoofable). No `requested_size` input -- buyer-selectable print sizing is out of MVP scope (R71 Appendix C), so the window is a single universal envelope.

### 1.2 Outputs

#### Accept

| Field | Type | Notes |
|---|---|---|
| ok | bool | true |
| width | int | px, from the JPEG SOF marker |
| height | int | px, from the JPEG SOF marker |
| megapixels | float | width * height / 1e6 |
| aspect_ratio | float | longer edge / shorter edge |
| jpeg_quality | int | estimated libjpeg-equivalent quality (>= 90) |

#### Reject

| Field | Type | Notes |
|---|---|---|
| ok | bool | false |
| error_code | enum | one of §1.3 |
| message | string | human-readable; names the failing parameter |

### 1.3 Error Codes

| Code | Trigger |
|---|---|
| INGESTION_FORMAT_NOT_JPEG | SOI magic bytes absent, or JPEG marker parse fails (SOF or luminance DQT unreadable) |
| INGESTION_WINDOW_FLOOR | long edge < 4200 px |
| INGESTION_WINDOW_CEILING_MEGAPIXELS | width * height > 38 MP |
| INGESTION_ASPECT_OUT_OF_BAND | longer / shorter edge outside [1, 2] |
| INGESTION_QUALITY_BELOW_Q90 | estimated libjpeg-equivalent quality < 90 |

Fixed taxonomy aligned with R71 §3.7 "Error conventions". Adding a code is a contract change.

### 1.4 Pre / Post Conditions

| Type | Condition |
|---|---|
| Post (accept) | no pixel modification; record describes file as received |
| Post (reject) | exactly one error_code from §1.3 |
| Post (always) | no external network call |
| Post (always) | same input -> same decision and error_code |

### 1.5 Acceptance Criteria

| ID | Given | When | Then |
|---|---|---|---|
| AC-01 | valid JPEG 5000x4000 (20 MP, aspect 1.25, est. Q92) | gate runs | accept per §1.2 |
| AC-02 | JPEG 4000x3300 (long edge < 4200) | gate runs | INGESTION_WINDOW_FLOOR |
| AC-03 | JPEG 8000x5000 (40 MP) | gate runs | INGESTION_WINDOW_CEILING_MEGAPIXELS |
| AC-04 | JPEG 6000x2400 (aspect 2.5) | gate runs | INGESTION_ASPECT_OUT_OF_BAND |
| AC-05 | JPEG estimated Q85 | gate runs | INGESTION_QUALITY_BELOW_Q90 |
| AC-06 | PNG or TIFF bytes (SOI absent) | gate runs | INGESTION_FORMAT_NOT_JPEG |

## 2. Functional Requirements

### 2.1 Format
JPEG only. Read the file's first two bytes and assert the JPEG SOI marker (`0xFF 0xD8`). Extension and `File.type` are spoofable; the magic-number check is the canonical format gate. Any non-JPEG -> INGESTION_FORMAT_NOT_JPEG. TIFF / PNG out of scope per R71 Appendix C.

### 2.2 Resolution (long-edge floor)

Long edge >= 4200 px -> else INGESTION_WINDOW_FLOOR. Dimensions read from the mandatory JPEG SOF marker (reliable for every valid JPEG, independent of EXIF presence). Floor derives from a 14 in long edge at 300 DPI (R71 §1.3). Short edge is implicitly bounded by `aspect_max` (§2.4): worst case short = 4200 / 2.0 = 2100 px, supporting up to a 14×7 in print at 300 DPI; no separate short-edge floor is enforced.

### 2.3 Megapixel Ceiling
`width * height <= 38 MP` -> else INGESTION_WINDOW_CEILING_MEGAPIXELS. Total-pixel maximum, structurally independent of the per-edge floor. Set 5% below Cloudinary's 40 MP transformation limit so an accepted image never fails the downstream transformation call (R71 §1.3, §3.3).

### 2.4 Aspect Ratio
`1 <= (longer edge / shorter edge) <= 2` -> else INGESTION_ASPECT_OUT_OF_BAND. Independent constraint.

### 2.5 JPEG Quality
Extract the luminance quantization table from the JPEG DQT marker; invert the IJG quality-scaling formula to derive the libjpeg-equivalent quality factor; assert `>= 90` -> else INGESTION_QUALITY_BELOW_Q90. Q90 matches typical camera / phone "fine" output (R71 §1.3).

### 2.6 Out-of-Scope Checks
Per revised R71, the following are NOT performed at this gate: TIFF losslessness, color-profile validation, file-size floor, C2PA manifest parse / verify, AI / generative-origin detection, upscaling detection. C2PA and invisible-watermark handling are deferred to MMP (see /docs/deferred/); synthetic-origin, NCII, right-of-publicity, and uniqueness are covered by creator contractual warranty per R71 §2.2 step 6.

## 3. Architecture (Dual-Validator)

### 3.1 Client-Side (R71 §2.2 step 3)
Runs entirely in the browser at file-select, before any upload. A single `exifr.parse(file, { sof: true, dqt: true })` pass yields width / height (SOF) and the luminance quantization table (DQT); the 2-byte SOI read is a native File API call outside exifr. The four window checks (long-edge floor, megapixel ceiling, aspect band, Q90 quality) are arithmetic on these outputs in a small in-house utility. A failing file is rejected pre-upload with the specific failing parameter displayed.

### 3.2 Server-Side (Authoritative)
Re-runs the identical checks on the uploaded bytes; the client report is not trusted. Server decision is binding; drm_csam (PhotoDNA Tier 0) and downstream DRM act only on a server Accept. See OI-01: R71 §2.2 names only the client-side gate explicitly.

### 3.3 Rule Consistency
Both validators apply identical rules. Every check is pure arithmetic over SOF + DQT outputs from a single shared `exifr.parse` call, so the split is trust (server re-run), not capability. The window rules (thresholds, IJG quality inversion, de-zigzag of the luminance QT) and both entry points live in one module (`technical`); the client and server entry points call a single shared decision function (`validateWindow`) and differ only in input shape -- `File` from the browser, `Uint8Array` from server-side bytes -- which `exifr.parse` accepts uniformly. The SOI check is done via a native 2-byte read on each side per R71 §2.2 step 3 (not via exifr, which would also fail on non-JPEG but is not R71's stated mechanism for the format check). Rule identity is therefore structural, not a property replay tests must police across two copies (INV-03).

## 4. Non-Functional Requirements

| Property | Specification |
|---|---|
| Determinism | same input -> same decision and error_code; no probabilistic checks; replay-test verified (INV-03) |
| Pixel non-modification | no alteration, recompression, or re-encoding (INV-04 at intake) |
| External network | none either side; all checks are local arithmetic over JPEG markers (INV-09) |
| Client-side performance | <= 1 s for files up to the 50 MB upload cap |
| Server-side performance | <= 100 ms p95 (marker parse + arithmetic; no C2PA / ML) |
| Memory bound | <= 2x input file size during processing |

## 5. Dependencies

| Dependency | Role |
|---|---|
| exifr | JPEG SOF + DQT marker parse (client and server) |
| in-house IJG quality inverter | libjpeg-equivalent quality from the luminance QT |
| native 2-byte read | SOI magic-byte format check |

No DB queries, no external APIs, no network during validation. c2pa-node, ICC profile parser, TIFF metadata reader, and the upscaling signature library are removed -- those checks are out of MVP scope.

## 6. Open Issues

| ID | Issue |
|---|---|
| OI-01 | R71 §2.2 lists only the client-side gate (step 3); confirm server-side re-validation is in MVP scope (retained here from prior architecture + INV-03) or whether MVP trusts the client gate |
| OI-02 | IJG quality inversion: luminance QT only vs both luminance + chrominance; numeric tolerance at the Q90 boundary |
| OI-03 | exifr SOF reliability across baseline vs progressive JPEG and non-standard marker ordering |
| OI-04 | aspect-ratio rounding tolerance at the 1.0 and 2.0 boundaries (inclusive vs exclusive) |

## 7. Cross-References

| Doc | Purpose |
|---|---|
| drm | parent subsystem |
| drm_csam | downstream Tier 0 gate (PhotoDNA); consumes a server Accept |
| R71 §1.3 | image ingestion window (floor, ceiling, format, quality, aspect) |
| R71 §2.2 step 3 | client-side ingestion gate |
| R71 §3.2 (exifr) | marker-parse library |
| R71 Appendix C | TIFF / PNG / 16-bit out of scope |
| R62 §7.1 | reference architecture for full ingestion-gate envelope |
| Constitution INV-03, INV-04, INV-09 | non-negotiable invariants |

---
*Last Updated: 26/06/10 11:20*
