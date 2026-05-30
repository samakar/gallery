# DRM Spectrographic Watermark

> **DEFERRED to post-MVP per revised R71.** R71 ships no invisible / spectrographic watermark: A.4 states "the invisible watermark and the perceptual-hash layer are out of scope," and the R71 §2.2 step 9 / §2.4 step 16 anchors cited below now describe Listing-preview + Thumbnail build and purchase confirmation respectively (no watermark step exists). MVP watermarking is visible Cloudinary overlays only (PREVIEW text, monogram, in-pixel URL text). Retained unchanged for MMP. Constitution tension: INV-04 (watermarks applied at render time) is satisfied at MVP only by those visible overlays -- pending constitution reconciliation.

Self-hosted deep-watermark embedder + extractor (StegaStamp-class). Two layers:
Creator watermark at ingestion (per-Master payload) and Owner watermark at
personalization (per-buyer payload). Same backend; different payload schemas;
both layers coexist on Edition / Copy renderings.

## 1. Interface

### 1.1 Inputs

#### embedCreator
Applied at ingestion after image_spec passes and before C2PA signing.

| Field | Type | Notes |
|---|---|---|
| file | bytes | JPEG or TIFF; has passed image_spec |
| master_id | string | platform-issued |
| creator_id | string | three-layer-identity-bound |
| ingestion_timestamp | string | ISO 8601 |

#### embedOwner
Applied at personalization, on resized Master + monogram + metadata layer.

| Field | Type | Notes |
|---|---|---|
| file | bytes | resized Master composition (Edition or Copy) |
| deed_id | string | Solana mint address |
| owner_wallet | string | buyer Solana address |
| edition_number | int | typically 1 (one-of-one MVP) |

#### extract
Forensic surface; runs against any suspect file to attribute leakage.

| Field | Type | Notes |
|---|---|---|
| file | bytes | any image; arbitrary format / size |

### 1.2 Outputs

#### Embed Pass (creator or owner)

| Field | Type | Notes |
|---|---|---|
| ok | bool | true |
| watermarked_file | bytes | output with watermark embedded; all non-pixel metadata preserved byte-identical (§2.8) |
| psnr | float | dB; >= 40 (imperceptibility threshold) |
| payload_bits | int | actual bits embedded (~100) |
| embedder_version | string | model build identifier |
| c2pa_action | object | descriptor for `c2pa.watermarked` action assertion + Soft Binding Assertion (§2.9); caller forwards to c2pa subsystem for manifest append |

#### Embed Reject

| Field | Type | Notes |
|---|---|---|
| ok | bool | false |
| error_code | enum | one of §1.3 |
| message | string | human-readable |

#### Extract Result

| Field | Type | Notes |
|---|---|---|
| ok | bool | true (extraction ran successfully; may still return zero payloads) |
| detected | object[] | per detected payload: layer (creator / owner), decoded payload, confidence |
| extractor_version | string | model build identifier |

Detected payload object:

| Field | Type | Notes |
|---|---|---|
| layer | enum | "creator" or "owner" |
| payload | object | decoded fields per §1.1 schema for that layer |
| confidence | float | [0, 1] |

### 1.3 Error Codes

| Code | Trigger |
|---|---|
| WATERMARK_EMBED_FAILED | embedder infra error or model failure |
| WATERMARK_EXTRACT_FAILED | extractor infra error |
| INVALID_INPUT_FORMAT | input is not JPEG or TIFF (embed) |
| IMPERCEPTIBILITY_FAILURE | output PSNR < 40 dB; embed declined to preserve quality |
| PAYLOAD_TOO_LARGE | payload encoding exceeds capacity (~100 bits) |

Fixed taxonomy. Adding a code is a contract change.

### 1.4 Pre / Post Conditions

| Type | Condition |
|---|---|
| Pre (embed) | input file is JPEG or TIFF; payload fields well-formed per §1.1 |
| Pre (extract) | none beyond a valid byte stream |
| Post (embed pass) | watermarked_file bytes differ from input; PSNR >= 40 dB; payload extractable from watermarked_file |
| Post (embed reject) | input file bytes unchanged; no watermark applied |
| Post (extract) | detected payloads returned with confidence; zero payloads on clean file |
| Post (always) | embedder / extractor versions logged |

### 1.5 Acceptance Criteria

| ID | Given | When | Then |
|---|---|---|---|
| AC-01 | clean 5000x4000 JPEG | embedCreator(file, master_id, creator_id, ts) | ok=true; PSNR >= 40 dB; extract(out).detected includes layer=creator with matching payload |
| AC-02 | watermarked JPEG re-encoded at Q70 | extract | detected includes original payload at confidence >= 0.7 |
| AC-03 | watermarked image cropped 20% | extract | detected includes original payload at confidence >= 0.5 |
| AC-04 | watermarked image screenshot at 1920x1080 | extract | detected includes original payload at confidence >= 0.5 |
| AC-05 | watermarked image printed at 300 DPI + scanned at 300 DPI | extract | detected includes original payload at confidence >= 0.4 |
| AC-06 | Edition with both Creator + Owner watermarks | extract | detected includes both layers |
| AC-07 | payload encoding > 100 bits | embed | error_code=PAYLOAD_TOO_LARGE |
| AC-08 | non-image bytes (random data) | extract | ok=true; detected=[] |
| AC-09 | PNG input | embed | error_code=INVALID_INPUT_FORMAT |

## 2. Functional Requirements

### 2.1 Embedder
StegaStamp-class self-hosted deep-watermarking model. Embeds payload in pixel-domain frequency coefficients via a forward inference pass on a pretrained encoder network. Output is perceptually identical to input (imperceptibility constraint).

### 2.2 Extractor
Counterpart decoder network. Forward inference on a candidate file returns a tuple of (detected layer, decoded payload, confidence) per recognized watermark.

### 2.3 Payload Schemas

| Layer | Fields | Encoding |
|---|---|---|
| Creator | master_id (40 bits), creator_id (40 bits), ingestion_timestamp (16 bits, day-resolution from platform epoch) | 96 bits + 4 bits parity / FEC = 100 bits total |
| Owner | deed_id (44 bits, Solana mint address compressed), owner_wallet (44 bits, buyer wallet hash), edition_number (8 bits) | 96 bits + 4 bits parity / FEC = 100 bits total |

Field-to-bit allocation is calibrated; future-proofing reserved bits handled by versioning the payload schema (drm_watermark OI-02).

### 2.4 Layering
Both watermarks may be present on the same output file. Encoder applies layers in sequence; each layer is independently extractable. No interaction except through cumulative PSNR budget.

### 2.5 Robustness Targets

| Channel | Survives |
|---|---|
| JPEG re-encode | Q70+ (lossy compression) |
| Screenshot | desktop screen capture at native resolution |
| Print-and-scan | 300 DPI print + 300 DPI scan |
| Crop | up to 30% area loss |
| Color space conversion | sRGB <-> AdobeRGB <-> Display-P3 |
| Resize | down to 1024px longest edge (Listing preview / thumbnail target) |
| Geometric transform | minor rotation (< 5 deg), minor skew |

### 2.6 Imperceptibility
Output PSNR vs input >= 40 dB. Output SSIM vs input >= 0.98. Failure aborts embed with IMPERCEPTIBILITY_FAILURE.

### 2.7 Forensic Use
Extractor is the post-leak attribution surface. Public detection invoked by Trust & Safety on suspect files (off-platform redistribution, takedown evidence). Confidence threshold for attribution publication is operationally calibrated (drm_spectrographic OI-04).

### 2.8 Preservation Guarantees
The embedder modifies only pixel-domain frequency coefficients (§2.1) within the imperceptibility envelope (§2.6). All existing EXIF / XMP / IPTC / ICC metadata is preserved byte-identical between input and output. No metadata field is stripped, renamed, or rewritten.

| Surface | Behavior |
|---|---|
| Pixel data | Modified within PSNR >= 40 dB, SSIM >= 0.98 envelope (§2.6) |
| EXIF | Preserved byte-identical |
| XMP | Preserved byte-identical |
| IPTC | Preserved byte-identical |
| ICC profile | Preserved byte-identical |
| C2PA manifest (existing) | Preserved as-is; the new `c2pa.watermarked` action is appended downstream by the c2pa subsystem (§2.9), not by this module |

### 2.9 C2PA Manifest Coordination
Per C2PA 2.1+ specification, an invisible pixel-domain watermark is recorded as a `c2pa.watermarked` action assertion paired with a Soft Binding Assertion describing the embedder algorithm and per-instance binding value. C2PA action assertions are non-redactable -- they are essential history per the C2PA spec.

This module does NOT mutate the C2PA manifest. Instead, the embed-pass output carries a `c2pa_action` descriptor (§1.2) that the caller forwards to the c2pa subsystem for append + re-sign.

| Output field | C2PA convention |
|---|---|
| c2pa_action.action | `c2pa.watermarked` |
| c2pa_action.softBinding.alg | embedder algorithm identifier (e.g., `elanoid-stegastamp-v1`) |
| c2pa_action.softBinding.value | per-instance binding value (hex-encoded payload bits) |
| c2pa_action.parameters.layer | "creator" or "owner" |

## 3. Non-Functional Requirements

| Property | Specification |
|---|---|
| Embed latency | <= 3 s p95 for 50 MB image (CPU) or <= 1 s p95 (GPU) |
| Extract latency | <= 5 s p95 (CPU) or <= 2 s p95 (GPU) |
| Imperceptibility | PSNR >= 40 dB; SSIM >= 0.98 (§2.6) |
| Capacity | ~100 bits per layer (§2.3) |
| False-positive rate (extract on clean file) | <= 1e-5 per call |
| False-negative rate (extract on watermarked file under typical degradation) | <= 0.1 |
| Determinism | embed is deterministic within embedder_version + payload (same inputs -> byte-identical output); extract is deterministic within extractor_version |
| Audit | embedder / extractor versions + PSNR + payload size logged per call |
| External network | none during embed or extract (INV-09 applies to server-side, all model inference local) |

## 4. Dependencies

| Dependency | Role |
|---|---|
| StegaStamp model weights (self-hosted) | encoder + decoder networks |
| ONNX Runtime (or PyTorch) | model inference |
| GPU (optional) | latency improvement for embed + extract |
| Payload codec library | bit-packing + FEC (e.g., Reed-Solomon) for ~100-bit payloads |
| drm_c2pa | downstream consumer of c2pa_action descriptor (§2.9); appends + re-signs manifest |

No DB queries, no external APIs.

## 5. Open Issues

| ID | Issue |
|---|---|
| OI-01 | StegaStamp variant + training corpus choice; license terms for commercial deployment |
| OI-02 | Payload schema versioning: how does extractor handle multiple schema versions (V1, V2) coexisting in the wild |
| OI-03 | GPU vs CPU provisioning at MVP volume (10 creators, ~100 sales / 30 days) |
| OI-04 | Forensic-attribution confidence threshold for publication: false-positive cost vs leak-detection sensitivity |
| OI-05 | Color-profile interaction: does embedder behave correctly on AdobeRGB inputs or does it assume sRGB |
| OI-06 | Layering order: Creator-first-then-Owner vs Owner-first-then-Creator; PSNR budget allocation between layers |
| OI-07 | Print-and-scan robustness validation: physical-test corpus + acceptance threshold |
| OI-08 | Soft-binding algorithm identifier registration: convention is reverse-domain (e.g., `com.c2pa.alg.watermark.X`) or per-vendor (`elanoid-stegastamp-v1`); confirm against C2PA registry |
| OI-09 | Soft-binding value encoding: full payload bits vs payload hash; trade-off between manifest size and binding strength |

## 6. Cross-References

| Doc | Purpose |
|---|---|
| drm | parent subsystem |
| image_spec | upstream technical-quality gate |
| drm_c2pa | downstream manifest append for `c2pa.watermarked` action + Soft Binding Assertion (§2.9) |
| takedown | downstream consumer of forensic extraction |
| R71 §2.2 step 9 | Creator watermark MVP spec |
| R71 §2.4 step 16 | Owner watermark MVP spec |
| R71 §3.1 (StegaStamp-class self-hosted embedder) | library reference |
| [C2PA Technical Specification 2.4](https://spec.c2pa.org/specifications/specifications/2.4/specs/C2PA_Specification.html) | `c2pa.watermarked` action assertion convention |
| [C2PA Soft Binding API (2.4)](https://spec.c2pa.org/specifications/specifications/2.4/softbinding/Decoupled.html) | Soft Binding Assertion convention for watermark algorithm + binding value |
| R62 §2.1 | Creator watermark reference architecture |
| R62 §2.2 | Owner watermark reference architecture |
| Constitution INV-04 | no pixel modification of Master after ingestion (Creator watermark applied within ingestion window; Owner watermark applied to derivative Edition only) |

---
*Last Updated: 05/13/26 11:00*
