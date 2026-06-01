# Test Fixtures

Synthesised + occasionally real-world image files used to exercise the cert / commerce / registry gates. **Binary fixtures are gitignored**; `build.ts` regenerates the synthesisable ones deterministically. Hand-collected fixtures (e.g. phone photos with real EXIF) are committed.

## Layout

```
fixtures/
├── build.ts                       generator -- npx tsx fixtures/build.ts
├── README.md                      this file
│
├── image_spec/                    cert/image_spec.ts gate cases
│   ├── pass_4500x3500_q95.jpg     in-band -- expect ok
│   ├── reject_long_edge.jpg       3000x2500 -- INGESTION_WINDOW_FLOOR_LONG_EDGE
│   ├── reject_short_edge.jpg      4200x3000 -- INGESTION_WINDOW_FLOOR_SHORT_EDGE
│   ├── reject_megapixels.jpg      7000x6000 (42 MP) -- INGESTION_WINDOW_CEILING_MEGAPIXELS
│   ├── reject_aspect.jpg          6000x2000 (3:1) -- INGESTION_ASPECT_OUT_OF_BAND
│   ├── reject_quality.jpg         4500x3500 q60 -- INGESTION_QUALITY_BELOW_Q90 (server-side only)
│   └── reject_not_jpeg.png        PNG -- INGESTION_FORMAT_NOT_JPEG
│
├── uniqueness/                    cert/image_uniqueness.ts gate cases
│   ├── original.jpg               baseline
│   ├── identical_pixels.jpg       same pixels, metadata stripped -- Hamming = 0
│   └── perceptually_similar.jpg   q70 re-encode -- Hamming small (in-band per-creator)
│
├── headshot/                      Profile.tsx + server headshot gate
│   ├── pass_300x300.jpg
│   └── reject_100x100.jpg         too small -- HEADSHOT_TOO_SMALL
│
└── cloudinary/                    Cloudinary upload-mutation regression
    ├── exif_rotate_90.jpg         Orientation = 6; detects EXIF auto-rotation (synth)
    └── PXL_*.jpg                  hand-collected Pixel phone photo (committed; Orientation=1, full real EXIF)
```

## Diagnostic scripts

- `verify_cloudinary_bytes.ts` — upload → download → diff a real photo. Picks up `cloudinary/PXL_*.jpg` automatically. Run: `npx tsx fixtures/verify_cloudinary_bytes.ts`. Use to detect Cloudinary auto-rotation, metadata stripping, or recompression after any account-config change.

## Regenerating

```powershell
npx tsx fixtures/build.ts
```

Idempotent -- only rebuilds missing files. Pass `--force` to rebuild all.

## Why not commit the binaries

The generated JPEGs add ~30-40 MB to a clone and provide no value over the deterministic generator. Hand-collected fixtures (rare; phone photos for cases sharp can't synthesise like real-noise perceptual similarity) are committed individually with a comment in `build.ts` explaining their provenance.

## How they're used

No test runner is wired yet -- these are for ad-hoc verification against the running dev server:

```powershell
# image_spec gates
curl.exe -H "x-dev-user: creator" -F "file=@fixtures/image_spec/reject_aspect.jpg" `
    http://localhost:3000/v1/images
# expect: 400 with rejection code from validateServerSide once that gate runs

# uniqueness gate
curl.exe -H "x-dev-user: creator" -F "file=@fixtures/uniqueness/original.jpg" `
    http://localhost:3000/v1/images
# upload again with the same file -- expect: 409 CREATOR_DUPLICATE

# headshot
curl.exe -H "x-dev-user: creator" -F "file=@fixtures/headshot/reject_100x100.jpg" `
    http://localhost:3000/v1/creator/profile/headshot
# expect: 400 HEADSHOT_TOO_SMALL
```

When a test framework (vitest / jest) is wired, these become shared inputs for unit + integration tests.
