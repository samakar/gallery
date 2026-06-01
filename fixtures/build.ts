// build.ts
// Generate the synthesisable test fixtures. Idempotent unless --force.
// Run: npx tsx fixtures/build.ts [--force]
//
// Each output is a deterministic JPEG / PNG produced via sharp. Fixtures are
// gitignored; this script is the source of truth for what they should be.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FORCE = process.argv.includes('--force');

interface Job {
    rel: string;
    build: () => Promise<Buffer>;
    note?: string;
}

// Deterministic noisy-looking RGB pattern -- different sizes get different
// content so the perceptual hash isn't trivially shared.
function pattern(width: number, height: number, seed = 0): Buffer {
    const data = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 3;
            // Mix several frequencies so the result has detail rather than
            // gradient flatness -- gives phash something to work with.
            const r = Math.sin((x + seed) * 0.0137) * 60 + Math.cos(y * 0.0271) * 50 + 128;
            const g = Math.sin((x + y + seed) * 0.0191) * 70 + 128;
            const b = Math.cos((x - y + seed) * 0.0233) * 80 + 128;
            data[i]     = Math.max(0, Math.min(255, Math.round(r)));
            data[i + 1] = Math.max(0, Math.min(255, Math.round(g)));
            data[i + 2] = Math.max(0, Math.min(255, Math.round(b)));
        }
    }
    return data;
}

async function jpeg(width: number, height: number, quality: number, seed = 0): Promise<Buffer> {
    return sharp(pattern(width, height, seed), {
        raw: { width, height, channels: 3 },
    })
        .jpeg({ quality, mozjpeg: false })
        .toBuffer();
}

async function png(width: number, height: number, seed = 0): Promise<Buffer> {
    return sharp(pattern(width, height, seed), {
        raw: { width, height, channels: 3 },
    })
        .png()
        .toBuffer();
}

// Inject a minimal EXIF APP1 segment carrying just the Orientation tag
// (0x0112). sharp's .withExif() silently drops the tag when there's no input
// EXIF to merge into, so we write the bytes ourselves. JPEG segment lengths
// are big-endian; TIFF inside EXIF is little-endian ("II" marker).
function injectExifOrientation(jpeg: Buffer, orientation: number): Buffer {
    const exifMarker   = Buffer.from('Exif\0\0', 'binary');         // 6 B
    const tiffHeader   = Buffer.from([0x49, 0x49, 0x2A, 0x00]);      // II*\0  (LE)
    const ifd0Offset   = Buffer.from([0x08, 0x00, 0x00, 0x00]);      // IFD0 starts at offset 8
    const entryCount   = Buffer.from([0x01, 0x00]);                  // 1 entry
    const entry        = Buffer.from([
        0x12, 0x01,                                                  // tag 0x0112 Orientation (LE)
        0x03, 0x00,                                                  // type 3 SHORT
        0x01, 0x00, 0x00, 0x00,                                      // count 1
        orientation & 0xff, 0x00, 0x00, 0x00,                        // value (SHORT, padded)
    ]);
    const nextIfdOffset = Buffer.from([0x00, 0x00, 0x00, 0x00]);
    const payload = Buffer.concat([
        exifMarker, tiffHeader, ifd0Offset, entryCount, entry, nextIfdOffset,
    ]);
    const length = payload.length + 2;                                // length includes itself
    const lengthBytes = Buffer.from([(length >> 8) & 0xff, length & 0xff]);  // BE
    const app1 = Buffer.concat([Buffer.from([0xFF, 0xE1]), lengthBytes, payload]);

    // Insert APP1 immediately after SOI (0xFFD8). Any existing APP0/JFIF
    // segment trails afterwards -- decoders read markers in order.
    return Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
}

const jobs: Job[] = [
    // ---- image_spec ----------------------------------------------------
    {
        rel: 'image_spec/pass_4500x3500_q95.jpg',
        build: () => jpeg(4500, 3500, 95),
        note: 'in-band: long=4500>=4200, short=3500>=3300, MP=15.75<=38, aspect=1.286, q=95',
    },
    {
        rel: 'image_spec/reject_long_edge.jpg',
        build: () => jpeg(3000, 2500, 95),
        note: 'long edge 3000 < 4200 floor',
    },
    {
        rel: 'image_spec/reject_short_edge.jpg',
        build: () => jpeg(4200, 3000, 95),
        note: 'short edge 3000 < 3300 floor',
    },
    {
        rel: 'image_spec/reject_megapixels.jpg',
        build: () => jpeg(7000, 6000, 90),
        note: '42 MP > 38 MP ceiling',
    },
    {
        rel: 'image_spec/reject_aspect.jpg',
        build: () => jpeg(6000, 2000, 95),
        note: 'aspect 3.0 > 2.0 max',
    },
    {
        rel: 'image_spec/reject_quality.jpg',
        build: () => jpeg(4500, 3500, 60),
        note: 'quality 60 < Q90 floor (server-side gate)',
    },
    {
        rel: 'image_spec/reject_not_jpeg.png',
        // Small dimensions: the SOI check rejects on the first 2 bytes; size
        // doesn't matter and a 4500x3500 noise PNG is needlessly large (~40 MB).
        build: () => png(400, 300),
        note: 'PNG -- fails SOI check (size minimal; gate is byte-level)',
    },

    // ---- uniqueness ----------------------------------------------------
    {
        rel: 'uniqueness/original.jpg',
        build: () => jpeg(4500, 3500, 95, 42),
        note: 'baseline; phash anchor',
    },
    {
        rel: 'uniqueness/identical_pixels.jpg',
        // Same source + quality, no metadata. Sharp jpeg() by default strips
        // metadata so this is effectively a re-encode of the same pixels --
        // produces the same phash (Hamming = 0) and very close file bytes.
        build: () => jpeg(4500, 3500, 95, 42),
        note: 'same pixels, metadata stripped -- per-creator duplicate target',
    },
    {
        rel: 'uniqueness/perceptually_similar.jpg',
        build: async () => {
            // Same source, lower quality. Pixel data shifts slightly under
            // q70 recompression -- phash should remain close (Hamming small).
            const buf = pattern(4500, 3500, 42);
            return sharp(buf, { raw: { width: 4500, height: 3500, channels: 3 } })
                .jpeg({ quality: 70 })
                .toBuffer();
        },
        note: 'q70 re-encode of same content -- in-band per-creator match',
    },

    // ---- headshot ------------------------------------------------------
    {
        rel: 'headshot/pass_300x300.jpg',
        build: () => jpeg(300, 300, 90, 7),
        note: '>= 200x200 floor',
    },
    {
        rel: 'headshot/reject_100x100.jpg',
        build: () => jpeg(100, 100, 90, 11),
        note: 'below 200x200 floor',
    },

    // ---- cloudinary ----------------------------------------------------
    {
        rel: 'cloudinary/exif_rotate_90.jpg',
        build: async () => {
            // 1000x500 JPEG, then manually inject EXIF Orientation=6 (rotate
            // 90 CW). Cloudinary accounts with auto-orientation will store it
            // rotated to 500x1000 with Orientation cleared, mutating pixels.
            const base = await sharp(pattern(1000, 500, 99), {
                raw: { width: 1000, height: 500, channels: 3 },
            })
                .jpeg({ quality: 90 })
                .toBuffer();
            return injectExifOrientation(base, 6);
        },
        note: 'Orientation=6 sentinel -- exposes Cloudinary auto-rotate if enabled',
    },
];

async function main() {
    let built = 0;
    let skipped = 0;
    for (const job of jobs) {
        const outPath = path.join(ROOT, job.rel);
        if (!FORCE && fs.existsSync(outPath)) {
            skipped++;
            continue;
        }
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        const buf = await job.build();
        fs.writeFileSync(outPath, buf);
        const kb = Math.round(buf.length / 1024);
        console.log(`  built  ${job.rel.padEnd(45)} ${String(kb).padStart(5)} KB  ${job.note ?? ''}`);
        built++;
    }
    console.log(`\n${built} built, ${skipped} skipped${FORCE ? ' (--force)' : ''}.`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
