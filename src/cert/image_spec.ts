// image_spec.ts
// DRM Technical Quality Gate (R71 §1.3 ingestion window).
// Spec: /docs/cert/image_spec.md
//
// Two entry points share one decision:
//   validateClientSide(file)  - browser, before upload (R71 §2.2 step 3)
//   validateServerSide(bytes) - authoritative, after upload (§3.7 row 6)
//
// Library: exifr (R71 §3.2) for SOF + DQT marker parse. The SOI magic-byte
// check is done natively per R71 §2.2 step 3 ("read the file's first two
// bytes via the native File API") -- File.type is extension-derived and
// spoofable, so SOI is the canonical format gate.
//
// Checks (R71 §1.3):
//   Format       - JPEG SOI magic bytes
//   Resolution   - long edge >= 4200 px AND short edge >= 3300 px
//   Megapixels   - width * height <= 38 MP
//   Aspect ratio - 1 <= longer / shorter <= 2
//   JPEG quality - IJG-inverted libjpeg-equivalent quality >= 90

import exifr from "exifr";

// R71 §3.7 error conventions.
export type ImageSpecErrorCode =
    | "INGESTION_FORMAT_NOT_JPEG"
    | "INGESTION_WINDOW_FLOOR"
    | "INGESTION_WINDOW_CEILING_MEGAPIXELS"
    | "INGESTION_ASPECT_OUT_OF_BAND"
    | "INGESTION_QUALITY_BELOW_Q90";

export type ImageSpecResult =
    | {
        ok: true;
        width: number;
        height: number;
        megapixels: number;
        aspect_ratio: number;
        jpeg_quality: number;
    }
    | { ok: false; error_code: ImageSpecErrorCode; message: string };

const LONG_EDGE_MIN_PX = 4200;
const MAX_MEGAPIXELS = 38;
const ASPECT_MIN = 1;
const ASPECT_MAX = 2;
const MIN_JPEG_QUALITY = 90;

export async function validateClientSide(file: File): Promise<ImageSpecResult> {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "(none)";
    const mime = file.type || "(unknown)";

    let head: Uint8Array;
    try {
        head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
    } catch (err) {
        // Browser File API failure -- often a stale handle or OneDrive / network
        // share. Treat as non-JPEG and surface the OS-level reason.
        const why = err instanceof Error ? err.message : String(err);
        return reject("INGESTION_FORMAT_NOT_JPEG",
            `Could not read "${file.name}" (.${ext}, ${mime}): ${why}`);
    }
    if (!isJpegBySoi(head)) {
        return reject("INGESTION_FORMAT_NOT_JPEG",
            `"${file.name}" is .${ext} (${mime}); JPEG required (SOI marker absent).`);
    }

    // Client uses native HTMLImageElement for dimensions -- INV-09 (no network),
    // and avoids the exifr browser bundle which has known issues with raw JPEG
    // marker options. Quality (Q90) gate stays on validateServerSide which is
    // the authoritative check per spec; jpeg_quality is reported as 100 here
    // as a "not measured client-side" sentinel.
    let width = 0, height = 0;
    try {
        const dims = await readDimensions(file);
        width = dims.width;
        height = dims.height;
    } catch {
        return reject("INGESTION_FORMAT_NOT_JPEG", "Image could not be decoded.");
    }

    const longEdge = Math.max(width, height);
    const shortEdge = Math.min(width, height);
    if (longEdge < LONG_EDGE_MIN_PX) {
        return reject("INGESTION_WINDOW_FLOOR",
            `Long edge ${longEdge} px below floor ${LONG_EDGE_MIN_PX} px.`);
    }
    const megapixels = (width * height) / 1_000_000;
    if (megapixels > MAX_MEGAPIXELS) {
        return reject("INGESTION_WINDOW_CEILING_MEGAPIXELS",
            `${megapixels.toFixed(1)} MP exceeds ceiling ${MAX_MEGAPIXELS} MP.`);
    }
    const aspect_ratio = longEdge / shortEdge;
    if (aspect_ratio < ASPECT_MIN || aspect_ratio > ASPECT_MAX) {
        return reject("INGESTION_ASPECT_OUT_OF_BAND",
            `Aspect ratio ${aspect_ratio.toFixed(2)} outside [${ASPECT_MIN}, ${ASPECT_MAX}].`);
    }
    return { ok: true, width, height, megapixels, aspect_ratio, jpeg_quality: 100 };
}

function readDimensions(file: File): Promise<{ width: number; height: number }> {
    return new Promise((resolve, rej) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve({ width: img.naturalWidth, height: img.naturalHeight });
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            rej(new Error("decode failed"));
        };
        img.src = url;
    });
}

// Per INV-09: server-side gates may call external APIs but this one is local.
export async function validateServerSide(bytes: Uint8Array): Promise<ImageSpecResult> {
    if (!isJpegBySoi(bytes)) return reject("INGESTION_FORMAT_NOT_JPEG", "JPEG SOI marker absent.");
    return validateWindow(bytes);
}

// Single shared decision. exifr.parse accepts File and Uint8Array uniformly.
async function validateWindow(input: File | Uint8Array): Promise<ImageSpecResult> {
    const parsed = await exifr.parse(input, { sof: true, dqt: true }).catch(() => null);
    const width = parsed?.ImageWidth as number | undefined;
    const height = parsed?.ImageHeight as number | undefined;
    if (!width || !height) {
        return reject("INGESTION_FORMAT_NOT_JPEG", "JPEG SOF marker unreadable.");
    }

    const longEdge = Math.max(width, height);
    const shortEdge = Math.min(width, height);

    if (longEdge < LONG_EDGE_MIN_PX) {
        return reject("INGESTION_WINDOW_FLOOR",
            `Long edge ${longEdge} px below floor ${LONG_EDGE_MIN_PX} px.`);
    }

    const megapixels = (width * height) / 1_000_000;
    if (megapixels > MAX_MEGAPIXELS) {
        return reject("INGESTION_WINDOW_CEILING_MEGAPIXELS",
            `${megapixels.toFixed(1)} MP exceeds ceiling ${MAX_MEGAPIXELS} MP.`);
    }

    const aspect_ratio = longEdge / shortEdge;
    if (aspect_ratio < ASPECT_MIN || aspect_ratio > ASPECT_MAX) {
        return reject("INGESTION_ASPECT_OUT_OF_BAND",
            `Aspect ratio ${aspect_ratio.toFixed(2)} outside [${ASPECT_MIN}, ${ASPECT_MAX}].`);
    }

    const lumQt = extractLuminanceQt(parsed);
    if (!lumQt) return reject("INGESTION_FORMAT_NOT_JPEG", "JPEG luminance DQT (id 0) missing.");

    const jpeg_quality = invertIjgQuality(lumQt);
    if (jpeg_quality < MIN_JPEG_QUALITY) {
        return reject("INGESTION_QUALITY_BELOW_Q90",
            `Estimated quality ${jpeg_quality} below floor ${MIN_JPEG_QUALITY}.`);
    }

    return { ok: true, width, height, megapixels, aspect_ratio, jpeg_quality };
}

function reject(error_code: ImageSpecErrorCode, message: string): ImageSpecResult {
    return { ok: false, error_code, message };
}

function isJpegBySoi(bytes: Uint8Array): boolean {
    return bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xD8;
}

// exifr returns DQT entries as raw quantization tables in zigzag order (the
// JPEG file-format storage order). De-zigzag into natural (row-major) order
// so positions align with the IJG standard luminance table below.
function extractLuminanceQt(parsed: any): number[] | null {
    const dqt = parsed?.dqt ?? parsed?.DQT;
    const zig: ArrayLike<number> | undefined =
        Array.isArray(dqt) ? dqt[0] : (dqt?.[0] ?? dqt?.["0"]);
    if (!zig || zig.length !== 64) return null;
    const nat = new Array<number>(64);
    for (let k = 0; k < 64; k++) nat[ZIGZAG[k]] = Number(zig[k]);
    return nat;
}

// Invert the IJG linear quantization-scaling formula (libjpeg jcparam.c):
//   q[i] = clamp(floor((STD_LUM[i] * S + 50) / 100), 1, 255)
//   quality >= 50: S = 200 - 2 * quality  ->  quality = (200 - S) / 2
//   quality <  50: S = 5000 / quality      ->  quality = 5000 / S
// S is recovered per non-saturated coefficient and averaged for robustness.
function invertIjgQuality(qt: number[]): number {
    let sum = 0, n = 0;
    for (let i = 0; i < 64; i++) {
        const q = qt[i];
        if (q <= 0 || q >= 255) continue;     // skip saturated entries
        sum += (q * 100 - 50) / STD_LUM_NATURAL[i];
        n++;
    }
    if (n === 0) return qt.every(v => v <= 1) ? 100 : 1;
    const S = sum / n;
    const quality = S <= 0 ? 100 : S < 100 ? (200 - S) / 2 : 5000 / S;
    return Math.round(Math.max(1, Math.min(100, quality)));
}

// IJG luminance quantization base table (libjpeg, JPEG Annex K.1), natural order.
const STD_LUM_NATURAL: number[] = [
    16, 11, 10, 16, 24, 40, 51, 61,
    12, 12, 14, 19, 26, 58, 60, 55,
    14, 13, 16, 24, 40, 57, 69, 56,
    14, 17, 22, 29, 51, 87, 80, 62,
    18, 22, 37, 56, 68, 109, 103, 77,
    24, 35, 55, 64, 81, 104, 113, 92,
    49, 64, 78, 87, 103, 121, 120, 101,
    72, 92, 95, 98, 112, 100, 103, 99,
];

// JPEG zigzag scan order: ZIGZAG[k] = natural index of the k-th stored coefficient.
const ZIGZAG: number[] = [
    0, 1, 8, 16, 9, 2, 3, 10,
    17, 24, 32, 25, 18, 11, 4, 5,
    12, 19, 26, 33, 40, 48, 41, 34,
    27, 20, 13, 6, 7, 14, 21, 28,
    35, 42, 49, 56, 57, 50, 43, 36,
    29, 22, 15, 23, 30, 37, 44, 51,
    58, 59, 52, 45, 38, 31, 39, 46,
    53, 60, 61, 54, 47, 55, 62, 63,
];
