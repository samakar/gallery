# Deed (Registry)

Subsystem-level spec for the Epimage deed: cNFT issuance via self-mint Bubblegum V2, on-chain metadata schema, local-DB mirror, lifecycle state machine, and the seal-break + unsealing side effect. The Arweave Master encryption + upload subsystem is a separate concern; see [arweave_master.md](arweave_master.md).

## 1. Interface

### 1.1 Deed Schema

The deed's canonical fields. **All timestamps are ISO 8601 UTC** (`YYYY-MM-DDTHH:mm:ss.sssZ`) -- the platform stores everything in UTC and surfaces in UTC; clients localize at render time. All hex strings are lowercase. All base64 strings use standard alphabet (`A-Za-z0-9+/=`).

| Field | Type / Format | Min / Max | Storage tier | Anchored at | Mutable? | Source |
|---|---|---|---|---|---|---|
| image_id | string, base-36 lowercase (`[0-9a-z]`) | 5 / 8 chars (current generator emits 5; spec reserves up to 8 for future expansion when 36^5 = 60.5M IDs is exhausted; `epima.ge/<image_id>` stays within the 32-byte on-chain `name` cap at 8) | All three (local DB + Arweave JSON + on-chain leaf `name` as `epima.ge/<image_id>`) | Card 1 admission | No | `image_id_generator` |
| title | Unicode string (UTF-8 on the wire); any code point including emoji / CJK / RTL allowed | 1 / 120 chars (counted as Unicode code points, NOT bytes) | Arweave JSON + local Image.title | Card 1 (empty default); finalized at Card 3 | Yes (Card 3 edit before mint) | Creator input |
| description | Unicode string (UTF-8 on the wire); multi-line (`\n` allowed) | 50 / 2000 chars (code points) | Arweave JSON + local Image.description | Card 3 (min-length guard per R62 §3.2) | Yes (Card 3 edit before mint) | Creator input via guided prompt |
| creator_display_name | Unicode string (UTF-8 on the wire); any code point allowed | 1 / 80 chars (code points) | Arweave JSON + local Image.creator.display_name | Creator signup | Yes (creator profile edit) | Creator |
| creation_date | **ISO 8601 UTC date** (`YYYY-MM-DD`) | -- | Arweave JSON + local Image.creation_date | Card 1 (EXIF DateTimeOriginal extracted by `extractCreationDate`; creator override at Card 3) | No after mint | EXIF / Card 3 |
| arweave_master_uri | URL string, `https://arweave.net/<tx_id>` where tx_id is 43-char base64url | full URL ~63 chars | Arweave JSON + local Image.arweave_uri | Card 5 (mint) | No (per R71 immutability for the deed lifetime) | `arweave_master.buildAndUpload` |
| sha256 (M+00) | hex string, lowercase `[0-9a-f]` | exactly 64 chars (256 bits) | Arweave JSON + local Image.sha256 | Card 1 certify-time over upload buffer | No | `crypto.createHash('sha256')` |
| phash (M+00) | hex string, lowercase `[0-9a-f]` | exactly 16 chars (64-bit DCT pHash per ADR-0005) | Arweave JSON + local Image.phash | Card 1 uniqueness gate | No | `cert/image_uniqueness.sharpPhashComputer` |
| enc_final | base64 string | exactly 176 chars (132 raw bytes: 12 IV + 104 sealed-box + 16 AES tag) | (a) Arweave JSON only at first sale (lives inside the cNFT's metadata URI -- immutable thereafter; sealed to the first buyer's wallet pubkey); (b) **SPL Memo on each Bubblegum `transfer_v2` Solana tx for every subsequent sale** -- carries the rotated `enc_final` sealed to the new buyer's wallet pubkey. The cNFT's on-chain `uri` is never updated. To find the current owner's `enc_final`: walk the Bubblegum transfer log to their tenure-start tx, read the Memo. | Card 5 via `buildEncFinal(dek_image, owner_wallet_pubkey)` at mint; subsequent rotations via the transfer-tx Memo on each resale | Rotates per resale via transfer-tx Memo (post-MVP) | `cert/crypto.buildEncFinal` |
| enc_final_unwrapped | base64 string | exactly 140 chars (104 raw bytes: 32 ephemeral pubkey + 24 nonce + 32 DEK_image + 16 MAC) | (a) Local Deed.enc_final_unwrapped (read-fast DB mirror at MVP and forever); (b) **SPL Memo on a dedicated UNSEAL Solana tx** fired at the owner's first `/download-master`, co-signed by their wallet. The Memo carries the unwrapped sealed-box; the owner's wallet signature is the cryptographically-unforgeable consent (INV-02-enforced) to the seal-break. | First `/download-master` seal-break | Once per owner-tenure (sealed -> unsealed, monotonic per D-18); a fresh UNSEAL Memo fires for each new owner after their own first download | `cert/crypto.buildEncFinalUnwrapped` |
| buyer_sales_agreement_signing_event_id | UUID v4 string referencing `signatures.id` -- the DB primary key for the buyer's per-image SALES_AGREEMENT click event | exactly 36 chars (`8-4-4-4-12` hex) | Arweave JSON only | Card 4 (ESIGN capture; bundled with MJA on first purchase) | No | `cert/esign.captureSignature` -- per [esign.md](../cert/esign.md), the click is also recorded as a Solana transaction co-signed by the buyer's wallet; the tx signature lives on `signatures.solana_tx_signature` and is the trustless on-chain anchor of the consent. The UUID here is the read-fast DB key; the tx signature is the cryptographic-strength record. |
| creator_sales_agreement_signing_event_id | UUID v4 string referencing `signatures.id` -- the DB primary key for the creator's per-image SALES_AGREEMENT click event (the seller side of the same document the buyer signs at Card 4) | exactly 36 chars (`8-4-4-4-12` hex) | Arweave JSON only | Card 1 (ESIGN capture; bundled with COA at the creator's image-listing flow) | No | `cert/esign.captureSignature` -- per [esign.md](../cert/esign.md). At MVP the creator signs SALES_AGREEMENT under platform-default terms (royalty 10%, edition 1/1) read from the active binder. Per-image variation is post-MVP. |
| royalty_pct | int (basis-points stored on-chain as `sellerFeeBasisPoints` = pct * 100) | 0 / 100; fixed at **10** at MVP | On-chain `sellerFeeBasisPoints` + Arweave JSON | Card 5 | No at MVP (single-tier) | Fixed 10 |
| royalty_recipients (creators array) | array of `{ address: string, verified: bool, share: int }`; shares sum to exactly 100 (else on-chain `CreatorShareTotalMustBe100`) | 1 / `MAX_CREATOR_LIMIT` entries (Bubblegum V2 raises `CreatorsTooLong` past the cap; historical Metaplex Token Metadata value is 5, not re-verified for V2). MVP uses 1 entry (platform-only when creator wallet absent) or 2 (creator 90% + platform 10%). | On-chain mintV2 creators + Arweave JSON | Card 5 | Yes (rotates on resale to swap seller for new buyer) | resolved at mint from `images.creator.user.wallet_address` |
| edition | string | fixed `"Unique (1 of 1)"` at MVP | Arweave JSON | Card 5 | No at MVP | Limited / Unlimited edition tiers post-MVP (OI on this section); single-edition mint at MVP |
| asset_id | Solana cNFT asset_id, base58 (`[1-9A-HJ-NP-Za-km-z]`) | 32 / 44 chars (typically 43-44) | On-chain (cNFT identity); local Deed.asset_id mirror | Card 5 mintV2 confirm | No | Predicted via `findLeafAssetIdPda`, verified post-confirm |
| owner_wallet_address | Solana pubkey, base58 | 32 / 44 chars | On-chain (cNFT leafOwner); local Deed.owner_wallet_address mirror | Card 5 mint; rotates on resale via PermanentTransferDelegate | Yes (on resale) | Buyer's Magic wallet |
| custody_state | enum string, exactly one of: `sealed` \| `unsealed` \| `burned` | 6 / 8 chars (`burned` = 6; `unsealed` = 8) | Local Deed.custody_state only at MVP (column is named `deed_state` in the DB for migration backward-compat, mapped via `@map("deed_state")`; on-chain sync per PM-04) | Card 5 `sealed`; transitions per §2.3 (custody machine) | Yes, monotonic | `applyMintSucceeded` (initial) + `/download-master` (sealed → unsealed) + voluntary-burn endpoint + termination sweeper |
| legal_state | enum string, exactly one of: `legit` \| `disputed` \| `void` | 4 / 8 chars (`void` = 4; `disputed` = 8) | Local Deed.legal_state only at MVP (on-chain sync post-MVP) | Defaults `legit` at mint; transitions per §2.3 (legal machine) | Yes (`disputed → legit` reversal on counter-notice; otherwise monotonic) | Multi-sig admin tool (legit ↔ disputed ↔ void). Voluntary owner-burn leaves legal_state at `legit`. |
| variant_hashes | JSON string. Shape: `{ "M+00": {sha256, anchored_at, owner_ordinal?}, "M+01": {...}, "E+N": {...} }`. `sha256` = 64 hex chars; `anchored_at` = **ISO 8601 UTC datetime**; `owner_ordinal` = positive int | 1 entry (M+00 at mint) / no hard upper bound; ~10-20 entries over a deed's lifetime | **Local Deed.variant_hashes (JSON string column) only -- NOT on-chain or in Arweave JSON.** M+00 is also carried inline as the top-level `sha256` field in the Arweave JSON (the canonical mint-time anchor); M+N and Keepsake Copy (E+N) hashes stay in this DB column per F-01. Recording per-render variant sha256 on-chain is operational overhead with weak audit value: variants are deterministic from (canonical Master, monogram, owner ordinal) -- the inputs are already on permanent record, so the hash is a derivable, not a load-bearing, anchor. | M+00 at mint; M+01 on first download; E+N at Card 6 | Append-only | `crypto.createHash` at each variant build |
| minted_at | **ISO 8601 UTC datetime** | -- | Local Deed.minted_at | Card 5 confirm | No | `applyMintSucceeded` |
| created_at | **ISO 8601 UTC datetime** (Prisma `@default(now())` in UTC) | -- | Local Deed.created_at | Deed row insertion | No | Prisma default |
| updated_at | **ISO 8601 UTC datetime** (Prisma `@updatedAt`) | -- | Local Deed.updated_at | Any field update | Auto-updated on every write | Prisma |
| monogram_text (R62 §3.5.1 personalization) | string, uppercase ASCII letters `[A-Z]` | 1 / 3 chars | (a) `Purchase.monogram_text` for the read-fast UI / Cloudinary render pipeline; (b) **SPL Memo on the resale transfer-tx** as the on-chain canonical rotating field from second sale onward (post-MVP). NOT in Arweave JSON (the JSON is mint-time immutable and the monogram rotates per owner) | Card 6 (BuyWizard monogram step) | Rotates on resale via the transfer-tx Memo (post-MVP); platform DB always carries the current value as the operational read path | Buyer input |
| creator_coa_signing_event_id | UUID v4 string referencing `signatures.id` -- the DB primary key for the creator's COA click event for this image (signing the authenticity attestation; formerly "ISA") | exactly 36 chars (`8-4-4-4-12` hex) | Arweave JSON only | Card 5 (read from `images.signing_event_id_coa` at dispatch) | No | Captured at Card 1 COA click. Per [esign.md](../cert/esign.md), the click is also recorded as a Solana tx co-signed by the creator's wallet; `signatures.solana_tx_signature` is the on-chain anchor. UUID here is the read-fast key; tx signature is the trustless record. |
| creator_coa_signed_at | **ISO 8601 UTC datetime** | -- | Arweave JSON only | Card 5 (read from `signatures.clicked_at` joined via the ID above) | No | Captured at Card 1 COA click |
| legal_binder_tx_id | base64url string, 43 chars (Arweave tx_id only; the `https://arweave.net/` prefix is reconstructed on-read by string-concat) | 43 chars | (a) Arweave JSON at first sale -- records the binder under which all five signed contracts (creator's CMA + COA + SALES_AGREEMENT; buyer's MJA + SALES_AGREEMENT) were captured. Immutable thereafter; (b) **SPL Memo on each Bubblegum `transfer_v2` Solana tx for every subsequent resale** -- the new owner's `legal_binder_tx_id` is carried in the tx Memo alongside `enc_final`, `price`, and `monogram` | Card 5 dispatch -- read from `getActiveBinder().arweave_uri`. Mint refuses unless all five signed contracts carry this same URI on their `Signature.legal_binder_tx_id`; stale signatures trigger re-sign UI before mint proceeds | No on the Arweave JSON (first sale's binder is permanent). Yes on each resale Memo -- the new owner's binder URI is captured on their tenure-start transfer tx. | See [cert/legal_binder.md](../cert/legal_binder.md). Single URI captures the **full counterparty agreement stack** -- CMA, COA, SALES_AGREEMENT, MJA all live as `entries[]` inside the binder JSON at this URI. Any future tool can fetch the binder, walk entries[] to find any document type, and reconstruct exactly what the parties agreed to. The COA the deed renders today combines the binder's COA markdown source with per-deed fields already in this metadata JSON (title, sha256, creator_display_name, creator_coa_signing_event_id, creator_coa_signed_at). |

The synthetic `'draft'` state (no Deed row yet, no asset_id) is an API-layer fiction surfaced on `GET /v1/images/:image_id` for pre-sale listing-page coherence; the column never holds `'draft'`. See §2.3.

**Rights tuple**: the three fields `royalty_pct`, `royalty_recipients`, and `edition` together form the on-chain rights tuple Crossmint embeds in the cNFT at mint. At MVP they're fixed: 10% royalty to the creator's wallet, 100% single recipient, Unique (1 of 1) edition. Configurable per-deed royalty + multi-edition tiers are post-MVP -- the schema rows above accommodate variation, the MVP code path supplies constants. Enforcement of the royalty on resale is on-chain via the Metaplex Core royalty plugin (no platform involvement at transfer time); contractual binding of the buyer to the royalty arrangement is via SAL (the buyer's signed sale agreement carries `royalty_pct` as a prop per [legal_binder.md §1.1](../cert/legal_binder.md)).

### 1.1.1 Where Everything Lives

Schema rows above note each field's storage location. Visualized as one diagram, the deed is a three-level pointer chain plus a local read-mirror:

```
on-chain Bubblegum V2 cNFT leaf  (hashed to 32 bytes on Solana; *never updated after mint*)
├── asset_id                                      ← cNFT identity (immutable)
├── owner_wallet_address                          ← rotates on transfer (chain-native; no metadata write)
├── name = "epima.ge/<image_id>"                  ← immutable
├── symbol = "epimage"                            ← immutable
├── seller_fee_basis_points = 1000  (10 % royalty) ← immutable
├── creators[] = [platform, creator?]             ← immutable
├── collection = PLATFORM_COLLECTION_PUBKEY       ← immutable
└── uri  ──►  Arweave metadata JSON               ← immutable from mint forever

Arweave metadata JSON  (~1-2 KB; uploaded ONCE at mint; never re-uploaded; survives platform cessation)
{
  "name", "description", "image", "external_url",
  "title", "creator_display_name",
  "asset_id",                                       ← cNFT asset_id (Metaplex DAS); promoted to the Arweave `Asset-Id` tag. Lets a verifier confirm "this metadata is for asset X" without consulting Solana.
  "story",                                          ← OPTIONAL long-form photographer narrative (UI label "Story" per Magnum / WPP convention; wire field `story`). 0-4000 chars; **CommonMark Markdown** (incl. GitHub-flavored tables / strikethrough / task-lists); UI renders via `react-markdown` which escapes raw HTML by default (XSS-safe; no DOMPurify needed). Body-only; not tag-promoted. Omitted from JSON when null/empty.
                                                       Note: `description` carries the short marketplace-preview caption (UI label "Caption"; Metaplex requires this name; 40-280 chars, plain text).
  "creation_date",                                  ← when the photo was taken (ISO date; EXIF or manual)
  "edition_total",                                  ← total editions of this image (1 at MVP per R71 §3.6); image-level + stable across all edition mints. This deed's edition ordinal is NOT here -- it lives on the cNFT leaf so all editions of the same image share this one JSON.
  "creator_snapshot": {                             ← YouTube channel standing at the moment of seal (mirrored to deeds.creator_snapshot for fast UI reads)
     "channelId", "channelTitle", "handle",
     "subscriberCount", "subscriberCount_label",    ← YouTube returns rounded for public reads; label="rounded"
     "viewCount", "videoCount",
     "channelPublishedAt",                          ← channel join date -- Artist + Environment anchor
     "snapshot_timestamp",                          ← when this snapshot was taken
     "ownership_verified"                           ← true if creator passed YouTube OAuth at sign-cma
  },
  "video_snapshot": {                               ← creator-associated YouTube video frozen at seal (rot-proof against link/title changes); null when no video association
     "video_id", "video_title", "video_channelId",
     "publishDate",
     "thumbnail_hash",                              ← "sha256:<hex>" of the highest-res thumbnail YouTube returned
     "viewCount_at_seal",
     "moment_timestamp",                            ← integer seconds into the video where the scene occurs (fan-field binding)
     "source_url"                                   ← rot-prone convenience link; video_id is the durable handle
  },
  "image_spec": {                                   ← 7-field block per R62 §2.3 (mirrors Image.image_spec column)
     "width_px", "height_px", "color_space",
     "icc_profile", "color_depth_bits",
     "file_type", "file_size_bytes"
  },
  "capture_setup": {                                ← EXIF-derived camera/lens/exposure block read at Card 1 upload; mirrors Image.capture_setup column. Distinguishes professional capture (specific Make/Model + lens metadata + manual exposure + RAW + camera-programmed Artist) from phones/point-and-shoot defaults. Null when EXIF is unreadable.
     // Hardware identification
     "Make", "Model",
     "LensMake", "LensModel", "LensSerialNumber",
     "BodySerialNumber",                            ← presence alone leans professional
     // Physical optics & exposure
     "FNumber", "MaxApertureValue",                    ← lens's widest aperture (f-number); exifr converts from APEX
     "FocalLength", "FocalLengthIn35mmFilm",
     "ExposureTime",                                ← shutter speed, e.g. "1/2000"
     "ISOSpeedRatings",
     "ExposureProgram",                             ← "Manual" / "Aperture priority" / etc.
     // Capture format (derived from file container)
     "capture_format",                              ← "RAW" | "JPEG" | "HEIC" | "PNG" | "TIFF" | "unknown"; RAW is a near-binary professional signal
     // Professional workflow & ownership
     "Artist",                                      ← creator name pre-programmed into the camera body
     "Copyright",
     "ColorSpace",                                  ← "sRGB" / "Adobe RGB" / "Uncalibrated"
     "gps_record"                                   ← boolean: true when original EXIF had GPSLatitude/Longitude. **Coordinates themselves are NOT stored** (location privacy). Phones almost always write GPS; deliberate professional captures often don't.
  },
  "sha256",                                         ← sha256 of full upload buffer (pixels + metadata); the file's bytewise identity. Industry convention (matches Arweave `Sha256` tag on the encrypted Master upload). UI display label: "File fingerprint". Under the hood = images.sha256 column.
  "image_fingerprint",                              ← sha256 of the JPEG with metadata marker segments (APP1 EXIF/XMP, APP2 ICC, APP13 IPTC, COM) byte-surgically stripped. Compressed scan data byte-exact. Tool-independent given the strip rule in /src/cert/pixel_hash.ts. Null for non-JPEG containers. Descriptive name (no industry convention). UI display label: "Image fingerprint". Under the hood = images.pixel_sha256 column.
  "content_fingerprint",                            ← perceptual hash (visual similarity within a Hamming threshold); not an identity proof. Descriptive name (no industry convention). UI display label: "Content fingerprint". Under the hood = images.phash column.
  "enc_final"                                       ← first owner's sealed-box (immutable record of first-sale state)
  "buyer_sales_agreement_signing_event_id",         ← buyer's per-image SALES_AGREEMENT click (at Card 4, bundled with MJA on first purchase)
  "creator_sales_agreement_signing_event_id",       ← creator's per-image SALES_AGREEMENT click (at Card 1, bundled with COA)
  "creator_coa_signing_event_id",                   ← creator-side ESIGN (COA leg)
  "creator_coa_signed_at",
  "legal_binder_tx_id",                               ← URL of the legal binder active at first sale
  "creators", "properties.creators",
  "properties.files[]"  ──►  Arweave Master file (~5-8 MB, ZIP-AES-256, also one-time upload, immutable forever)
}

Arweave tags on the metadata JSON upload (the discovery index):
   Indexer convention:
     Content-Type:           application/json
     App-Name:               Epimage
     App-Version:            0.1                              ← producer code (semver)
     Schema:                 epimage.deed.metadata/v1         ← JSON body format version
     File-Name:              <image_id>.json
   Solana ecosystem convention:
     Image-Id:               <image_id>                       ← Epimage join key (also on Master)
     Asset-Id:               <solana_cnft_asset_id>           ← cNFT identifier (Metaplex DAS standard)
     Creator-Address:        <base58>                         ← Solana wallet address; "all my deeds" query
   Discovery (descriptive; emitted only when source non-null):
     Creator-Display-Name:   <string>                         ← search by artist name
     YouTube-Channel-Id:     UC...                            ← stable channel identity
     YouTube-Channel-Handle: @creator                         ← human-readable; frozen at mint
     Capture-Format:         RAW | JPEG | HEIC | PNG | TIFF   ← "show me RAW captures" filter
     Capture-Year:           2024                             ← temporal browse (year only)
     Image-Fingerprint:      <pixel_sha256 hex>               ← byte-identity forensic lookup
     Content-Fingerprint:    <phash hex>                      ← perceptual / near-duplicate lookup

   Upload time is queryable for free via Arweave's `block.timestamp` -- no
   tag needed. GraphQL: `block: { min, max }` + `sort: HEIGHT_DESC`.

Arweave tags on the encrypted Master upload (kept minimal -- discovery happens via JSON):
   Content-Type:        application/zip
   App-Name:            Epimage
   App-Version:         0.1
   File-Name:           <image_id>.zip
   Image-Id:            <image_id>            ← only join key needed
   Sha256:              <hex>                 ← Arweave/ArDrive convention; UI label "File fingerprint"
   Encryption:          ZIP-AES-256
   Encryption-Schema:   zip-aes256-dek-v1
              │
              └──►  Arweave Legal Binder JSON (uploaded ONCE at MVP launch; revisions are post-MVP)
                    {
                      "binder_version": <integer>,
                      "released_at", "supersedes_arweave_tx_id",
                      "entries": [
                        { id: "cma",     type: "CMA",                 content: <markdown> },
                        { id: "mja",     type: "MJA",                 content: <markdown> },
                        { id: "coa",     type: "COA",                 content: <markdown> },  // signed by creator at Card 1; renders to PDF for buyer delivery at mint
                        { id: "sales",   type: "SAL",                 content: <markdown> }
                      ]
                    }
                    All deeds minted under the same binder share this URI. Single URI =
                    the platform's full legal posture at that point in time. See cert/legal_binder.md.

Solana per-deed Memos  (NO side-car PDA; rotating state lives on the transfer + unseal Solana txs themselves)
├── Per-resale Memo on the Bubblegum transfer_v2 tx (atomic with the transfer; co-signed by HOT_RESALE_KEY + buyer's wallet)
│     payload: { "t":"SALE", "p":<price_cents>, "b":<legal_binder_tx_id>, "m":<monogram>, "e":<new enc_final 176 chars> }
│     -- carries the NEW owner's rotated sealed-box + sale price + binder under which they signed SALES_AGREEMENT.
│     -- to find the current owner's enc_final: walk Bubblegum transfer log to their tenure-start tx, read the Memo.
│
└── Per-owner Memo on a dedicated UNSEAL tx (separate Solana tx fired at first /download-master per owner; co-signed by HOT_OPS_KEY + owner's wallet)
      payload: { "t":"UNSEAL", "a":<asset_id>, "u":<enc_final_unwrapped 140 chars> }
      -- D-18 seal-break event; owner's wallet signature is INV-02-unforgeable consent.
      -- once per owner-tenure (subsequent downloads no-op the unseal).

Local DB mirror  (Image + Deed + Purchase rows; read-fast for the UI; never authoritative)
├── Image.arweave_uri              ← Arweave Master URL, denormalized for `/archive/<id>` proxy
├── Image.sha256, pixel_sha256, phash, image_spec, capture_setup
├── Deed.asset_id, owner_wallet_address, minted_at
├── Deed.custody_state, legal_state         ← two-axis state machine, §2.3
├── Deed.enc_final_unwrapped       ← D-18 seal-break mirror (authoritative source is the UNSEAL Memo)
├── Deed.creator_snapshot          ← JSON-stringified mirror of the Arweave metadata's creator_snapshot block
├── Deed.video_snapshot            ← JSON-stringified mirror of the Arweave metadata's video_snapshot block (null when no video association)
├── Deed.variant_hashes            ← M+00 only at MVP per F-01; M+N and Keepsake Copy hashes off-chain in this column, NOT on-chain
└── Purchase.monogram_text         ← per-buyer personalization (DB read-fast; on-chain authoritative is the resale Memo)
```

Key consequences of the architecture:
- **The cNFT leaf is never updated after mint.** On resale, only the chain-native Bubblegum `transfer_v2` instruction fires (signed by `HOT_RESALE_KEY` via `PermanentTransferDelegate`) + an SPL Memo instruction in the same atomic Solana tx. No `update_metadata_v1`, no `uri` swap, no new Arweave upload, no custom side-car Solana program.
- **The Arweave layer (Master file + metadata JSON + legal binder JSON) is uploaded once at first sale and never touched again.** All Arweave objects are immutable from mint forever, guaranteeing R72 trustless recovery: any future tool can reach the objects by tx_id without our platform's involvement.
- **All per-resale rotating state lives on the Solana resale Memo** -- `price`, `legal_binder_tx_id`, `monogram`, and the new `enc_final` sealed to the new owner. To read current state for any deed, walk the Bubblegum transfer log to the latest transfer, read the Memo payload. No PDA derivation, no extra account fetch.
- **D-18 seal-break is its own Solana tx** -- a dedicated UNSEAL Memo tx fires at the owner's first `/download-master`, co-signed by their wallet. INV-02-unforgeable on-chain proof of "this owner broke the seal at this slot." Cross-discoverable by `getSignaturesForAddress(owner_wallet)` filtered to Memo program.
- **Marketplaces** (Solana Explorer, Phantom, Magic Eden) fetch the on-chain `uri` and parse the Arweave JSON. They don't read the Memos. The Arweave JSON forever describes the first-sale state for marketplace presentation; current state lives on the chain via the resale Memos.
- **Platform cessation**: all Arweave objects keep serving. Solana's ledger keeps all Memos forever. Each owner retains decryption capability via the `enc_final` on their tenure-start transfer Memo (or the Arweave JSON's `enc_final` for the first owner) + PLATFORM_DEK (trustee-published per R72) + their wallet privkey.
- **Variant hashes off-chain (F-01)**: Master M+N and Keepsake Copy hashes are stored only in `Deed.variant_hashes` (local DB JSON). They are NOT recorded on-chain. The architecture commits to on-chain only the immutable mint-time M+00 hash (carried inside the Arweave JSON as `sha256`); subsequent variant hashes are operationally derivable.

**At MVP**: resale is not shipped (R71 §1.2). The resale-Memo and UNSEAL-Memo patterns activate when resale ships. Until then, rotating state (`monogram_text`, future resale `enc_final`, `enc_final_unwrapped`) lives in the local DB as the operational source. **No custom Solana program is needed at any phase** -- the SPL Memo program is a deployed standard. The `DEED_PROGRAM_ID` keypair reserved earlier is unused under this architecture (kept in cold storage in case a future architecture revisits the PDA path).

### 1.2 Operations

| Function | Signature | Notes |
|---|---|---|
| `dispatch` (mint a new deed) | `(image_id, buyer_wallet_pubkey, title, description, creator_display_name, arweave_uri, sha256, phash, enc_final, buyer_sales_agreement_signing_event_id, creator_sales_agreement_signing_event_id, creator_coa_signing_event_id, royalty_pct, creator_wallet) -> { ok, asset_id, crossmint_job_id (= mint tx signature), onchain_status, arweave_metadata_uri }` | Caller is `commerce/run_image_ops`. `buyer_email` + `preview_url` accepted for compat but unused at MVP. |
| `getDeedState` (read mirror) | `(asset_id) -> { ok, deed_state }` | Pure read from local mirror; <= 10 ms p95. |

### 1.3 Error Codes

| Code | Trigger |
|---|---|
| MINT_PARAMS_INVALID | buyer_wallet not a Solana base58 OR arweave_uri missing |
| ARWEAVE_UPLOAD_FAILED | Arweave Turbo metadata-JSON upload failed |
| MINT_SUBMIT_FAILED | Bubblegum V2 mintV2 submit / confirm failed |
| MINT_NOT_CONFIRMED | Solana did not reach `confirmed` within timeout |
| RACE_DETECTED | observed asset_id != predicted (post-confirm advisory check) |
| DEED_NOT_FOUND | `getDeedState` called with unknown asset_id |

### 1.4 Pre / Post Conditions

| Type | Condition |
|---|---|
| Pre | `arweave_uri` populated; `images.sha256` populated; all five SALES_AGREEMENT + COA + CMA + MJA signing_event_ids captured and under the active binder; HOT_MINT_KEY balance > minimum threshold |
| Post (dispatch) | cNFT minted to `buyer_wallet_pubkey` under the platform Bubblegum V2 tree under the MPL-Core Collection; on-chain `uri = arweave_metadata_uri`; `deeds` row inserted with `asset_id` + `crossmint_job_id` (tx signature) + `owner_wallet_address`; `deed_state = 'sealed'` initially; `enc_final_unwrapped = null` initially |
| Post (`/download-master` seal-break, per D-18) | `deed_state` advanced to `'unsealed'`; `variant_hashes["M+01"]` anchored; `enc_final_unwrapped` populated with `sealed_box(DEK_image, owner_wallet_pubkey)` base64 |

### 1.5 Acceptance Criteria

| ID | Given | When | Then |
|---|---|---|---|
| AC-01 | all inputs valid; tree has capacity | `dispatch(...)` | `asset_id` returned; on-chain owner == `buyer_wallet_pubkey`; on-chain uri == `arweave_metadata_uri`; `deeds` row inserted |
| AC-02 | tree has no capacity | `dispatch(...)` | dispatcher routes to next tree per sharding policy (PM-05); deed mints under that tree's mutex |
| AC-03 | Solana RPC unavailable | `dispatch(...)` | `MINT_SUBMIT_FAILED`; mutex released; sweeper retries per ADR-0007 |
| AC-04 | Arweave Turbo returns 402 | `dispatch(...)` | `ARWEAVE_UPLOAD_FAILED`; mutex released; sweeper retries |
| AC-05 | minted deed | `getDeedState(asset_id)` | returns current `deed_state` from local mirror |
| AC-06 | unknown asset_id | `getDeedState(asset_id)` | `DEED_NOT_FOUND` |
| AC-07 | deed exists; first `/download-master` succeeds | follow-up `getDeedState` | returns `'unsealed'`; `Deed.enc_final_unwrapped` is non-null base64 |

## 2. Functional Requirements

### 2.1 Mint Architecture (Vendor + Standard)

**Vendor: self-mint.** The platform mints directly via the `@metaplex-foundation/mpl-bubblegum` SDK. No external mint service. Operational cost is a small SOL treasury (~$100 per 100k mints at bare-chain economics) covering tx fees.

**Standard: Bubblegum V2 compressed NFT grouped under an MPL-Core Collection.** Marginal mint cost ~$0.001. REQ-MINT-02 (platform-mediated resale) is enforced cryptographically via sealed `enc_final` plus on-chain permanent plugins (PermanentFreezeDelegate + PermanentTransferDelegate at the collection level); no on-chain transfer-freeze is required. Architectural rationale + alternatives considered live in [ADR-0008](../adr/adr_0008_self_mint_bubblegum_v2.md).

| Requirement | Source | Enforcement |
|---|---|---|
| REQ-MINT-02: Platform-mediated resale + creator/platform royalty | R62 | Cryptographic (sealed `enc_final` re-keyed on resale via the SPL Memo on the Bubblegum `transfer_v2` Solana tx; cNFT metadata never updated post-mint; no custom Solana program needed) + structural (PermanentFreezeDelegate + PermanentTransferDelegate at collection level) |
| REQ-MINT-03: Per-owner-changing fields off-Arweave | R62 | `monogram_text` lives in `Purchase.monogram_text` (platform DB), rendered into Share Copy server-side at delivery time |
| REQ-MINT-04: Deed permanence + asset_id self-identification | R62 | Path 4 mint sequence: per-tree mutex reserves predicted_asset_id BEFORE the Arweave upload, so the metadata JSON carries the correct asset_id; embedded provenance manifest + per-event Arweave snapshots are post-MVP polish per PM-06 |

### 2.2 Path 4 Mint Sequence (per dispatch call)

```
1.  Validate buyer_wallet is a Solana base58 pubkey + arweave_uri is set
2.  Acquire per-tree mint mutex
3.  fetchTreeConfigFromSeeds -> read num_minted = N
4.  predicted_asset_id = findLeafAssetIdPda(tree_pubkey, N)
5.  Build creators array (creator 90% + platform 10%, or platform 100% if creator wallet missing)
6.  Build Arweave metadata JSON (REQ-MINT-03 image-identity fields; monogram excluded)
7.  Upload metadata JSON to Arweave Turbo -> arweave_metadata_uri
8.  Construct + submit mintV2 instruction with uri = arweave_metadata_uri,
    sellerFeeBasisPoints = royalty_pct * 100, collection = PLATFORM_COLLECTION_PUBKEY
    Signers: HOT_MINT_KEY (payer), HOT_OPS_KEY (treeCreatorOrDelegate), COLD_RECOVERY_KEY (collectionAuthority)
9.  Await Solana `confirmed` commitment -> tx signature
10. Advisory check: read tree state post-mint; warn if observed leaf_index != predicted (RPC lag tolerance)
11. Persist Deed row via post_mint.applyMintSucceeded (sets deed_state='sealed', variant_hashes M+00, owner_wallet, asset_id, minted_at)
12. Release mint mutex
```

### 2.3 Lifecycle State Machines

The deed has **two orthogonal state machines**. The custody axis tracks what the platform *can* do (decrypt, deliver, host derivatives). The legal axis tracks whether the platform *should* do it (good standing, under adjudication, invalidated). Treating them as one column led to repeated reshape pressure; splitting them lets voluntary owner-burn, third-party adjudication, and compliance preservation each live where they naturally belong.

#### Custody state machine

```
draft (synthetic, API-only) ──> sealed ──> unsealed
                                  │            │
                                  └────────────┴──> burned (terminal)
```

| From | To | Trigger | Requires |
|---|---|---|---|
| `draft` (synthetic) | `sealed` | `applyMintSucceeded` creates the Deed row | Buyer payment confirmed, monogram chosen, mintV2 confirmed. `draft` is API-synthetic only -- the `custody_state` column never holds `'draft'` so INV-10 totality applies only to real values. |
| `sealed` | `unsealed` | First `/v1/deeds/:imageId/download-master` (body `{ initials }`) | Deed-holder authenticated; legal_state is `legit` (see legal machine guard). **Per [D-22](../divergences.md), the request body must carry the buyer's typed initials** -- the server captures a DLN (Master Download Notice) signature BEFORE the seal-break (`cert/esign.captureSignature` → Signature row + Solana-tx Memo per esign.md §2.8). Empty initials reject with `INITIALS_REQUIRED`. **Per [D-21](../divergences.md), the platform does NOT decrypt the Master.** The endpoint returns JSON `{ archive_url, arweave_uri, password = base64(DEK_image), filename_hint, custody_state }`. The owner's browser shows a password-reveal modal + "Download ZIP from Arweave" button; the buyer fetches the encrypted ZIP from Arweave and extracts client-side. **D-18 side effect (unchanged)**: platform peels outer PLATFORM_DEK wrap of `enc_final` to produce `enc_final_unwrapped`, published via UNSEAL Memo co-signed by the owner's wallet. `Deed.enc_final_unwrapped` is a DB mirror for fast UI reads. After this transition the deed is no longer eligible for platform-facilitated resale at MVP. |
| `sealed` / `unsealed` | `burned` | (a) **Voluntary owner-burn** -- owner signs the deterministic challenge `epimage:burn-deed:<image_id>:<minted_at>` with their wallet (PM-11); OR (b) **Termination sweeper** picks up a deed where `legal_state='void' AND destruction_eligible_at <= now()` (PM-10) | (a) owner wallet signature is the authorization -- no multi-sig, no refund, immediate. (b) automated -- the adjudication decision was already made at `legal_state: disputed → void`. **Sweeper actions**: destroy Cloudinary source + invalidate derived caches; delete the encrypted Master from `EncryptedMasterStore` (no-op if already cleared by `arweave_ready_sweeper`); null out `Image.dek_wrapped` + `Image.arweave_uri` + `Deed.enc_final_unwrapped`; on-chain operation per `termination_method` audit field (`update_metadata_v1` keeps the leaf as tombstone OR Bubblegum `burn` removes it). Arweave bytes remain (out of platform control). |

#### Legal state machine

```
legit ──> disputed ──> legit       (counter-notice prevails)
            │
            └──────> void          (adjudicated against; terminal)
```

| From | To | Trigger | Requires |
|---|---|---|---|
| (default at mint) | `legit` | `applyMintSucceeded` initial value | n/a |
| `legit` | `disputed` | Any takedown event -- DMCA, RoP, Take It Down Act, court order, CSAM allegation, criminal seizure, regulatory directive | 3-of-5 multi-sig confirms the report is not frivolous (INV-06; procedural at MVP per PM-03). Per-event compliance hooks fire during adjudication (e.g. §2258A NCMEC report for CSAM, court notification for court orders); these are operational specifics of the dispute event, not state-machine inputs. Side effect: `/download-master` + `/a/:imageId` proxy guards refuse serving while legal_state ≠ `legit`. |
| `disputed` | `legit` | Counter-notice prevails OR investigation clears | 3-of-5 multi-sig. Platform-mediated access restored. |
| `disputed` | `void` | Adjudicated against the deed | 3-of-5 multi-sig. Effects: (a) `Image.visibility = 'private'`; (b) per-reason compliance hold timer starts (`destruction_eligible_at = now + reason_specific_grace`; per PM-10 table); (c) buyer refund issued per R62 §4.9; (d) per-reason compliance reporting fires (e.g. §2258A NCMEC). The Cloudinary + local-disk artifacts are PRESERVED during this state for compliance / appeals; destruction happens later when the termination sweeper transitions custody_state to `burned`. |

#### State combinations (all 9 are valid)

| custody | legal | Meaning |
|---|---|---|
| `sealed` | `legit` | Fresh mint; no extraction, no complaint |
| `unsealed` | `legit` | Typical post-download steady state |
| `sealed` | `disputed` | Takedown notice received; buyer never extracted; multi-sig adjudicating |
| `unsealed` | `disputed` | Takedown notice received; buyer already has their copy; multi-sig adjudicating |
| `sealed` | `void` | Adjudication concluded against the deed; compliance hold preserving storage; buyer never extracted |
| `unsealed` | `void` | Same, but the buyer already extracted (D-18 disclosure is in their hands forever) |
| `burned` | `legit` | Voluntary owner-burn outside any dispute -- owner exercised property right |
| `burned` | `disputed` | **Transient.** Owner voluntarily burned during a non-preservation-required dispute. The multi-sig still closes out the dispute afterward -- typically `burned/disputed → burned/legit` (moot, the asset is destroyed) or `burned/disputed → burned/void` (formal upheld ruling for the audit record). Blocked by PM-11 only when the dispute carries `preservation_required=true` (CSAM, criminal seizure, court-ordered preservation, regulator-ordered preservation). |
| `burned` | `void` | Adjudicated invalid → sweeper executed deletion after compliance hold expired (the standard third-party-driven termination path) |

There are **no invalid state combinations** from the platform's perspective. All constraints live on **transitions**, not on states:

| Transition rule | Where it lives |
|---|---|
| `custody` is monotonic to `burned` (no un-burn) | Custody transition rule -- physical fact, the bytes are gone |
| `legal: void` is terminal (no un-void) | Legal transition rule -- adjudication is final |
| Voluntary owner-burn rejected when active dispute has `preservation_required=true` | Voluntary-burn endpoint guard (PM-11) |
| Adversarial transitions (e.g., setting `legal: void` without going through `disputed` first) | Multi-sig admin tool refuses |

Once `custody=burned`, the legal axis can still move (`burned/disputed → burned/legit` or `burned/disputed → burned/void`) because multi-sig may need to close out a dispute that was open at burn time. After both axes reach a terminal state, the audit record is fixed forever.

### 2.4 Resale Re-Key (post-MVP)

**On resale, one atomic Solana tx fires: Bubblegum `transfer_v2` + SPL Memo. Nothing else moves.** Specifically:

1. **Bubblegum `transfer_v2`** (signed by `HOT_RESALE_KEY` via the collection's `PermanentTransferDelegate` + buyer's wallet) updates the cNFT's `leafOwner` to the new buyer's wallet pubkey.
2. **SPL Memo** instruction in the same tx carries the rotating state, sealed to the new owner:
   ```jsonc
   {
     "t": "SALE",
     "p": <price_cents>,                          // sale price
     "b": "<legal_binder_tx_id>",                   // binder under which the new buyer signed MJA + SALES_AGREEMENT (enforced by ESIGN to be the currently-active binder)
     "m": "<monogram>",                           // the new buyer's chosen 3-letter mark
     "e": "<176-char enc_final base64>"           // sealed to the new owner's wallet pubkey
   }
   ```
   Total Memo size: ~280 bytes.

The owner-initiated D-18 seal-break is **NOT** part of this tx -- it's a separate UNSEAL Memo tx fired at the new owner's first `/download-master`. Per §2.3 the seal-break record IS its own Solana tx, co-signed by the new owner's wallet (different signer than the resale tx, where buyer signs but only as the new owner being credentialed, not as the unseal authorizer).

**What does NOT happen on resale:**
- No `update_metadata_v1` -- the cNFT's on-chain `uri` field is never updated after mint.
- No new Arweave upload -- the mint-time Arweave metadata JSON, encrypted Master file, and legal binder JSON are immutable forever. The Arweave JSON's `legal_binder_tx_id` continues to record the first-sale binder; subsequent owners' binder URIs live on their tenure-start transfer Memos.
- No mutation of the cNFT's `name`, `symbol`, `creators[]`, `seller_fee_basis_points`, or `collection` fields.
- **No custom Solana program** -- the SPL Memo program is a deployed standard.
- **No PDA** -- there is no side-car account; rotating state lives directly on the transfer-tx Memo.

**Per-resale cost (estimated, mainnet at $200/SOL):**
- ~$0.000005 for the Solana transaction base fee (one tx with two instructions)
- ~$0.0000003 marginal cost for the Memo bytes
- $0 Arweave (no upload)
- **Total: ~$0.000005 per resale**, instant. No custom-program rent, no PDA initialization cost.

**Discovery recipe for the current owner's decryption capability:**
1. Walk Bubblegum transfer log to identify the current owner's tenure-start tx (the most recent transfer to them).
2. If owner ordinal = 1 (first buyer): read `enc_final` from the deed's Arweave metadata JSON (their sealed-box never moves -- it's set at mint).
3. Else (resale buyer): read `enc_final` from the Memo on their tenure-start transfer tx.
4. Owner's wallet privkey + PLATFORM_DEK (trustee-published post-cessation per R72, or platform-held during operational life) → `DEK_image` → decrypt Master.

**Backfill at resale activation (one-time, if applicable):** post-MVP, when the resale feature ships, no migration is required for already-minted deeds. The first-sale `enc_final` on each existing Arweave JSON continues to serve the first buyer; the resale-Memo pattern only activates on the FIRST resale event, at which point the new owner's enc_final lands on the chain naturally.

**INV-02 preservation**: identical to MVP. The Memo's `enc_final` is publicly readable on Solana (Memos are public), but it's sealed-box-encrypted to the owner's wallet pubkey. Without the owner's wallet privkey, the bytes are useless. The platform never sees the owner's privkey at any point in resale.

**Audit-truth note**: the resale Memo IS itself the cryptographic-strength record of the sale (transfer atomic with the rotation; new owner's wallet co-signs the transfer; sale price + binder URI in the same Memo). No PDA-vs-Memo "convenience layer" distinction; this Memo is the authoritative record. See [cert/legal_binder.md §2.4.1](../cert/legal_binder.md) for the broader audit-truth path.

Resale is itself post-MVP per R71 §1.2.

### 2.5 INV-06 Multi-Sig Enforcement (MMP-operative)

3-of-5 ops approvers each sign the operation payload off-chain (ed25519 over a canonical operation-description payload). HOT_OPS_KEY signs the on-chain `update_metadata_v1` (or burn) only after the threshold is met. Signed approvals appended to a tamper-evident audit log (Merkle-root anchored to Arweave on a defined cadence). Procedural at MVP; on-chain Squads multi-sig is an ADR-gated amendment if rolled out at scale, not an architectural shortfall.

INV-06 trigger events (`legit → disputed`, `disputed → legit`, `disputed → void` on the legal axis) only occur when takedowns or resale-driven disputes happen, both of which are themselves out of MVP scope -- so the procedural-multisig admin tool itself is PM-03 deferred to MMP. The custody `sealed/unsealed → burned` transition does NOT require multi-sig because it is either (a) sweeper-driven after the adjudication decision was already made at `legal_state: disputed → void` and the compliance hold expired, or (b) owner-initiated voluntary burn where the owner's wallet signature is the authorization (PM-11).

## 3. Architecture

### 3.1 Signer Key Set

| Key | Role | Custody at MVP | Custody at production |
|---|---|---|---|
| `HOT_MINT_KEY` | Pays tx fees on mintV2; serves as Umi identity for the dispatcher | Server `.env` (single keypair, base58) | Same; balance-monitored (SOL-treasury top-up + alert threshold tracked in the go-live checklist, not this spec) |
| `HOT_OPS_KEY` | Tree authority for `update_metadata_v1` (used only for dispute-related tombstones via INV-06). Also payer + co-signer on UNSEAL Memo txs (D-18 seal-break). NOT used for resale re-key -- the SPL Memo on the Bubblegum transfer tx replaces that path. | Server `.env` | Same; INV-06 events gate via procedural admin tool per PM-03 |
| `COLD_RECOVERY_KEY` | Collection update_authority + collectionAuthority on mintV2; freeze-authority rotation key | Server `.env` (acceptable for dev/staging) | Hardware wallet (Ledger/Trezor), offline, designated officer custody (custody-officer assignment + rotation drill tracked in the go-live checklist) |

### 3.2 Collection + Tree

| Concern | Implementation |
|---|---|
| Standard | Bubblegum V2 cNFT grouped under MPL-Core Collection |
| Collection plugins (set once at collection creation, *permanent*) | `PermanentFreezeDelegate(frozen=true, authority=COLD_RECOVERY_KEY)`; `PermanentTransferDelegate(authority=HOT_RESALE_KEY)`; `Royalties(creators=[creator 90%, platform 10%])`; `BubblegumV2` plugin |
| Soulbound posture | Structural via `PermanentFreezeDelegate` -- buyer-initiated transfer reverts at chain layer; cryptographic backstop via `enc_final` sealed to owner |
| Tree depth (MVP staging) | depth 10 -> 1,024 leaves (sufficient for MVP testing) |
| Tree depth (production target) | depth 14+ with non-zero canopy so proof fits in a single tx without account lookups |
| Tree authority | `HOT_OPS_KEY` (recorded as tree creator at setup time) |
| Tree rollover policy | Roll a new tree when the active tree approaches capacity; PM-05 |

### 3.3 Per-Tree Mint Mutex (REQ-MINT-04)

In-process Node mutex held across the Path 4 reservation -> Arweave-upload -> mintV2 window. Single-instance at MVP; distributed lock (Redis SETNX, Postgres advisory lock, or dedicated single-writer dispatcher service) when scaled out per PM-01 / PM-07. Mutex hold window is dominated by the Arweave Turbo upload (~5-15s for the metadata JSON), so observed throughput ceiling per tree is ~4-12 mints/minute. Race detection at step 10 of §2.2 is advisory (single-instance mutex prevents concurrent mints in-process); cross-instance races are handled by re-derive + retry per AC-04.

### 3.4 Local Deed Table Mirror

Solana is authoritative; the local `deeds` row exists for fast UI rendering + ownership-gating lookups without per-request RPC. Prisma schema:

```prisma
model Deed {
  image_id             String   @id
  asset_id             String   @unique
  owner_wallet_address String
  owner_id             String
  deed_state           String   @default("sealed")
  variant_hashes       String   // JSON: { "M+00": {sha256, anchored_at}, "M+01": {...}, "E+N": {...} }
  enc_final_unwrapped  String?  // base64 of sealed_box(DEK_image, owner_wallet_pubkey); populated at seal-break per D-18
  minted_at            DateTime
  created_at           DateTime @default(now())
  updated_at           DateTime @updatedAt

  image Image @relation(fields: [image_id], references: [image_id])
  owner Owner @relation(fields: [owner_id], references: [user_id])
}
```

### 3.5 Bubblegum V2 SDK Integration

| Operation | SDK call | Signers |
|---|---|---|
| Mint a new deed | `mplBubblegum.mintV2` via Umi | HOT_MINT_KEY (payer + identity), HOT_OPS_KEY (treeCreatorOrDelegate), COLD_RECOVERY_KEY (collectionAuthority) |
| Read asset state | `getAsset` via DAS-RPC (Helius / Triton / Shyft) | none (public read) |
| Predict asset_id pre-mint | `findLeafAssetIdPda(tree, num_minted)` | none (PDA derivation) |
| Update cNFT metadata (only for: dispute-related tombstones via INV-06, NOT for resale) | `mplBubblegum.updateMetadataV2` | HOT_OPS_KEY (treeCreatorOrDelegate), COLD_RECOVERY_KEY (collectionAuthority); requires DAS `getAssetProof` |
| **Resale Memo** (carries new `enc_final` sealed to new owner + price + binder + monogram, atomic with the Bubblegum transfer) | SPL Memo Program -- composed in the same Solana tx as `transfer_v2` (post-MVP) | HOT_RESALE_KEY + buyer's wallet; no DAS proof needed; no custom program |
| **UNSEAL Memo** (carries D-18 unsealed sealed-box for the current owner) | SPL Memo Program -- separate Solana tx fired at first `/download-master` per owner (post-MVP) | HOT_OPS_KEY + owner's wallet (consent); fire-and-forget broadcast pattern per esign.md §2.8 |

### 3.X Arweave tag + JSON body naming policy

The two Arweave uploads per deed (metadata JSON + encrypted Master) follow a deliberate set of naming + tagging rules. New tags / fields must conform.

**Naming hierarchy** (applies to every wire-format identifier -- tag name, body field, API field, code type, schema field):

1. **Industry convention first.** If a recognized convention exists (Arweave: `Sha256`, `Content-Type`; Solana/Metaplex: `Asset-Id`, `creators[].address`; HTTP: `Content-Type`), use it verbatim -- even when it conflicts with our internal style.
2. **Descriptive otherwise.** When no convention exists, use a name that self-explains (`Image-Fingerprint`, `Capture-Format`, `image_fingerprint`).
3. **UI display labels are always descriptive.** Wire-format identifiers and UX text are decoupled: the field is `asset_id` (Solana convention), the label says "Deed number" (user-friendly). Same pattern: `sha256` field → "File fingerprint" label.

**Case style:**

| Surface | Style | Example |
|---|---|---|
| Arweave tags | `Pascal-Hyphen-Case` | `Image-Fingerprint`, `Asset-Id` |
| JSON body fields | `snake_case` | `image_fingerprint`, `asset_id` |
| Code (TypeScript) | matches body (`snake_case`) for wire types, `camelCase` for local vars | `input.creator_wallet`, `predictedAssetId` |

**Tag categories:**

| Category | Examples | Body counterpart |
|---|---|---|
| Transport / constants (tag-only, no body) | `Content-Type`, `App-Name`, `App-Version`, `File-Name` | Describe the Arweave upload itself, not the deed content. Industry convention says tag-only. |
| Industry-convention identifiers | `Sha256`, `Asset-Id`, `Schema`, `Creator-Address` | Match Arweave / Metaplex / HTTP conventions for ecosystem-tool compatibility |
| Descriptive discovery tags | `Image-Fingerprint`, `Content-Fingerprint`, `Capture-Format`, `Capture-Year`, `YouTube-Channel-Id`, `YouTube-Channel-Handle`, `Creator-Display-Name` | Every value MUST be reachable in the body (nested OK; no duplication) |

**Tag/body alignment rules:**

1. **Every searchable tag has a body counterpart.** Tags that can't be located anywhere in the body break the audit contract; either add the tag value to the body or drop the tag.
2. **No duplicate values in the body.** If a value is already in a nested block (e.g., `capture_setup.capture_format`, `creator_snapshot.channelId`, `properties.creators[].address`), do NOT also add a flat top-level field with the same value. Nested location is canonical; the tag promotes one field for queryability.
3. **Tag promotion pattern.** A tag is a flat copy of a body field for indexer queries. Body is structured + complete; tag is searchable + flat.
4. **Conditional emission.** Tags whose source value is `null` or `'unknown'` are omitted at upload, not emitted with empty values. Indexer filter behavior stays clean.

**Master vs JSON tag separation:**

| Concern | Rule |
|---|---|
| Discoverability tags belong on JSON only | A search for `Creator-Address: X` should return one Arweave object per deed (the JSON), not two (JSON + Master). Master gets minimum structural tags. |
| Master shares only one join key with JSON | `Image-Id` is the only tag both files carry. Verifiers join `Image-Id` to find both. |
| Master tags allowed | `Content-Type`, `App-Name`, `App-Version`, `File-Name`, `Image-Id`, `Sha256` (industry convention for content hash), `Encryption`, `Encryption-Schema` |

**Versioning axes** (orthogonal -- bump independently):

| Axis | Tag | Format | Bump on |
|---|---|---|---|
| Producer code | `App-Version` | semver (`0.1`, `1.0`, `2.0`) | Upload-handler implementation changes |
| JSON body schema | `Schema` (body: `schema`) | `epimage.deed.metadata/v<N>` | Body field set additions / removals |

**Native Arweave timestamps:** upload time is queryable for free via Arweave's `block.timestamp`. No `Minted-At` tag needed unless second-level precision on the Solana mint time becomes required (post-MVP).

**Privacy / mutability rules:**

| Don't tag | Reason |
|---|---|
| PII (legal names, addresses, email) | Tags are public + indexed; the user spec already constrains what crosses the public boundary |
| Mutable post-mint values (owner_wallet, current price) | Tags are immutable; rotating values make the tag misleading |
| Exact GPS coordinates | The `gps_record` boolean inside `capture_setup` is the privacy-preserving signal -- absolute coordinates stay in the encrypted Master only |
| Camera body / lens serial numbers | Individually-identifying for one-camera owners; trade-off the user excluded after review |

**How to add a new tag** (process):

1. Decide category (transport / convention / discovery).
2. Pick name per the hierarchy above.
3. Identify body location (top-level if conventional name; nested if it lives inside an existing structured block like `capture_setup` or `creator_snapshot`).
4. Add to body first; add tag as a flat promotion second.
5. Add conditional emission if source can be null.
6. Update this section's tag inventory.

## 4. Non-Functional Requirements

| Property | Specification |
|---|---|
| Mint latency (dispatch call) | <= 17 s p95 total (Arweave metadata upload + Solana confirmed); ~6 s p50 |
| Throughput per tree | ~4-12 mints/minute (Arweave-bound under mutex) |
| `getDeedState` latency | <= 10 ms (Prisma read on the local mirror) |
| Audit | Pino `cnft.dispatch` log line per mint with image_id, asset_id, tree_pubkey, leaf_index, arweave_metadata_uri, mint_tx_signature |
| Race detection rate | < 0.1% under single-instance mutex; logged + recovered per AC-04 |
| INV-06 enforcement | At write time (MMP only); procedural at MVP, on-chain Squads optional at scale |
| INV-10 totality | Static exhaustive switch on the `deed_state` enum at every consumer |

## 5. Dependencies

| Dependency | Role |
|---|---|
| `@metaplex-foundation/mpl-bubblegum` | mintV2 + updateMetadataV2 + findLeafAssetIdPda + fetchTreeConfigFromSeeds |
| `@metaplex-foundation/mpl-core` | MPL-Core Collection management (set once at collection creation) |
| `@metaplex-foundation/umi-bundle-defaults` | Umi context + RPC client + keypair signer |
| `@ardrive/turbo-sdk` | Arweave Turbo bundler client for metadata JSON upload |
| Solana RPC (Helius / Triton / public) | tx submission + confirmation polling |
| DAS-RPC (Helius / Triton / Shyft) | Required for `updateMetadataV2` (proof fetching); NOT required for initial mint |
| `cert/crypto.buildEncFinal` | Constructs `enc_final` from `DEK_image` + buyer wallet pubkey (caller responsibility -- run_image_ops invokes) |
| `cert/crypto.buildEncFinalUnwrapped` | Used at `/download-master` seal-break to compute D-18 disclosure |
| `commerce/run_image_ops` | Upstream caller (step e of the buy pipeline) |
| `registry/post_mint.applyMintSucceeded` | Persists the Deed row + flips Image to sold; runs after `confirmed` |
| `process.env.PLATFORM_TREE_PUBKEY` | Active Bubblegum tree |
| `process.env.PLATFORM_COLLECTION_PUBKEY` | MPL-Core Collection |
| `process.env.HOT_MINT_KEY` / `HOT_OPS_KEY` / `COLD_RECOVERY_KEY` | Signer keypairs |
| `prisma.deed` | Local mirror |

## 6. Open Issues

Open issues unresolved and required for MVP-live operation use OI-NN IDs. Deferred features and architectural enhancements needed before specific future events (multi-instance scale-out, takedown / dispute resolution, resale activation, MMP launch -- but not before MVP) use PM-NN IDs. Architectural decisions already made at MVP (single-instance mutex, single-provider DAS-RPC, `is_mutable: true` trees) are captured inline in §3 Architecture, not here. Operational hardening for the production deployment is tracked separately in the [go-live checklist](../go_live_checklist.md).

| ID | Item |
|---|---|
| PM-01 | **Distributed mint-mutex.** In-process Node mutex is shipped for single-instance MVP (§3.3). When scaling to multi-instance: Redis SETNX with TTL, Postgres advisory lock, or dedicated single-writer dispatcher service. Race-detection edge case (advisory post-mint check finding observed_asset_id != predicted) is functionally impossible under the single-instance mutex; matters only after distributed-lock ships. Resolution path when it matters: re-derive asset_id from observed leaf_index, re-upload metadata, re-mint (orphan ~$0.07 Arweave upload). |
| PM-02 | **DAS-RPC failover policy.** Single-provider (public devnet at MVP, vendor like Helius/Triton/Shyft in production) is operative for `updateMetadataV2` (used only for dispute-related tombstones via INV-06; not for resale, which uses Memo-on-transfer that doesn't need a DAS proof). Multi-provider failover (round-robin + circuit-breaker on degraded responses) is post-MVP. |
| PM-03 | **Procedural-multisig admin tool for INV-06 events.** Scope of operations gated, approval UI, signature requirements per approver (ed25519 signed event over a canonical operation-description payload), audit log persistence (tamper-evident; signed append-only log with periodic Merkle-root anchoring to Arweave). Needs to ship before the first `legit → disputed`, `disputed → void`, or third-party-driven `custody → burned` event in production. Voluntary owner-burn (custody → burned with legal staying `legit`) does NOT require this tool; see PM-09. Until then, single-key `HOT_OPS_KEY` signs all metadata updates. |
| PM-04 | **D-18 on-chain mirror via UNSEAL Memo.** Currently `Deed.enc_final_unwrapped` lives in the local DB only. Under the Memo-based architecture, first `/download-master` per owner fires a dedicated Solana tx with an UNSEAL Memo carrying the unwrapped sealed-box, co-signed by the owner's wallet. Lands when resale ships (paired with PM-11). The DB column stays as a read-fast UI mirror; the Solana Memo is the authoritative source for post-cessation auditors. |
| PM-05 | **Tree-capacity rollover policy.** A depth-14 tree holds 16,384 leaves; the dev/staging tree at depth-10 holds 1,024. At sustained MVP volume capacity exhaustion is months-to-years away, but the rollover ceremony (create new tree, switch HOT_MINT_KEY's tree delegate target, retire the old tree) needs spec before it becomes urgent. Existing deeds stay in their original tree forever. |
| PM-06 | **REQ-MINT-04 polish: embedded provenance manifest + Arweave snapshots.** EXIF/XMP entries in the encrypted Master (asset_id, sha256, phash, tree_root_at_mint_time, mint_timestamp, platform_signature) + per-event Arweave snapshot for each mint/transfer/update so tree-wide reconstruction is independent of DAS providers. Per-event cost ~$0.0001; weekly cadence cheaper. Recommended per-event for clean per-asset 200-year story. |
| PM-07 | **Tree sharding policy.** Single tree under Path 4 mutex caps at ~4-12 mints/minute (Arweave-bound). At sustained MVP volume this ceiling is unreachable; sharding is purely a scale concern. When needed: distribute mints across N trees with per-tree mutex; consistent-hash by image_id or round-robin. Trees stay independent; existing deeds never need migration. |
| PM-08 | **PROVENANCE_SIGNER_KEY.** Only relevant once PM-06 is implemented. Held server-side, separate from HOT_MINT_KEY / HOT_OPS_KEY / HOT_RESALE_KEY. Rotation policy + public-key publication path (so 200-year verifiers can find the historical pubkey). |
| PM-09 | **Per-termination audit metadata** on the Deed row (or a dedicated `deed_terminations` table). When `legal_state` transitions to `void`, OR `custody_state` transitions to `burned` via voluntary owner-burn, the platform records: `termination_reason` (enum: `dmca` \| `rop` \| `take_it_down_act` \| `court_order` \| `csam` \| `criminal_seizure` \| `regulatory_directive` \| `voluntary_owner_request`); `termination_method` (enum: `metadata_update` for cNFT leaf retained as on-chain tombstone, vs `leaf_burn` for Bubblegum `burn` removing the leaf entirely -- per-case operational policy, e.g. CSAM gets `leaf_burn`); `voided_at` (ISO 8601 UTC, set at `legit → void` via `disputed`; null for voluntary-burn paths); `destruction_eligible_at` (ISO 8601 UTC, = `voided_at + per_reason_grace`; the sweeper reads this; for voluntary burns this equals the request time, grace = 0); `burned_at` (ISO 8601 UTC, set at `custody → burned`); `multi_sig_record` (FK or JSON of the 3-of-5 procedural-tool signatures; null for voluntary-burn paths); `owner_burn_signature` (base64 ed25519 signature over the deterministic challenge `epimage:burn-deed:<image_id>:<minted_at>`; populated only for voluntary-burn paths); `preservation_required` (boolean; set by the multi-sig admin tool at `legit → disputed` based on `termination_reason` -- true for `csam` and `criminal_seizure`, operator-decided for `court_order` and `regulatory_directive`, false otherwise; PM-11 voluntary-burn endpoint refuses when this is true); `compliance_actions_taken` (JSON array, e.g. `["ncmec_report_filed_2026-06-15", "stripe_refund_issued_2026-06-16"]`); `destruction_log` (JSON array of {asset, result, timestamp} entries written by the sweeper). Cross-ref: state machines §2.3, INV-06 procedural multi-sig (PM-03), deletion workflow (PM-10), voluntary burn endpoint (PM-11). |
| PM-10 | **Custody-side deletion workflow (`termination-sweeper`).** The sweeper transitions `custody_state: sealed/unsealed → burned` when **either** (a) `legal_state='void' AND destruction_eligible_at <= now()` (third-party-driven path) OR (b) a voluntary-burn request has been processed (per PM-11). **Per-reason grace periods** (`destruction_eligible_at - voided_at`) for path (a): `csam` = **90 days** (§2258A preservation for law-enforcement use); `dmca` = **14 days** (counter-notice window per 17 U.S.C. § 512(g)); `take_it_down_act` = **0 days** (statute requires removal within 48h of notice; voiding IS the removal); `rop` = **14 days** (case-law analog to DMCA counter-notice); `court_order` = **0 days unless the order specifies preservation** (sweeper consults `compliance_actions_taken`); `criminal_seizure` = **per LE direction** (typically 90+ days); `regulatory_directive` = **per regulator** (manual override); `voluntary_owner_request` = **0 days** (no third-party rights at stake). **Sweeper actions on `custody → burned`** (in order; each step idempotent): (1) `image_gen.deleteAsset(image_id)` destroys Cloudinary source and triggers `invalidate: true` to evict derived caches at the CDN edge; (2) `fs.unlink(encryptedMasterPath(image_id))` removes the local encrypted Master; (3) `prisma.image.update({ data: { dek_wrapped: null } })` strips platform-side recoverability of `DEK_image`. **`Image.arweave_uri` is intentionally preserved** -- the Arweave bytes are permanent regardless of what we do, so nulling the URL would only hide our own audit reference; (4) `prisma.deed.update({ data: { enc_final_unwrapped: null } })` best-effort scrubs the D-18 disclosure (the buyer may already have an external copy -- documented limit); (5) per `termination_method`: `metadata_update` → on-chain `update_metadata_v1` notes custody_state `burned` (leaf preserved as tombstone), OR `leaf_burn` → Bubblegum `burn` instruction removes the leaf entirely; (6) `prisma.deed.update({ data: { custody_state: 'burned', burned_at: now() } })`. **What survives even after `burned`**: Arweave bytes (out of platform control), post-cessation R72 trustee-published `PLATFORM_DEK`. **Owner**: takedown subsystem + new `app/workers/termination_sweeper.ts` (cron-like, runs hourly). |
| PM-11 | **Voluntary owner-burn endpoint** `POST /v1/deeds/:imageId/voluntary-burn`. Auth: deed-holder only (`Deed.owner_id === user_id`). Body: `{ wallet_signature, confirmation_text }`. Server actions: (a) verify the wallet signature over the deterministic challenge `epimage:burn-deed:<image_id>:<minted_at>` (Magic SDK or external wallet); (b) confirm the literal `confirmation_text` matches an expected phrase ("I understand this is irreversible"); (c) **preservation-required guard**: if `legal_state='disputed'` AND the active dispute's audit row carries `preservation_required=true`, reject with HTTP 423 `BURN_BLOCKED_BY_PRESERVATION_HOLD`; (d) record the audit row per PM-09 with `termination_reason='voluntary_owner_request'`, `destruction_eligible_at=now()`; (e) immediately enqueue the sweeper to execute the custody → burned transition per PM-10. **No multi-sig** required (owner consent is the authorization). **No refund** issued. **`legal_state` is NOT mutated**: if there's an active dispute, the multi-sig still closes it out afterward. **UI**: new "Burn my deed" affordance in the Deed of Ownership panel for owners, gated behind a two-step modal (explainer + wallet-signing). If `legal_state='disputed'` but preservation-required = false, modal also warns "There is an active dispute; burning now may waive your ability to defend it." Documented in [legal/cma.md](../../legal/cma.md) §8. |
| PM-12 | **Universal burn-state render** across all public surfaces. When `Deed.custody_state='burned'`, **every** anonymous-facing route returns the same neutral response regardless of `termination_reason`. HTTP **410 Gone** body `{ error: "IMAGE_NOT_ON_PLATFORM" }` on: `GET /v1/images/:imageId`, `GET /v1/images/:imageId/deed`, `GET /i/:imageId`, `GET /a/:imageId`, and any future image-content route. Frontend Image page renders a stub showing only "The image is not on the platform." -- no creator name, no asset_id, no Buy / Report affordances, no OG image, `<meta name="robots" content="noindex,nofollow">`. **Owner-facing override** (authenticated viewer matches `Deed.owner_id`): Collection grid + deed-page route show the burned deed entry with minimal context "You destroyed this deed on `<burned_at>`" OR "This deed was removed on `<burned_at>`" (no `termination_reason` exposed) + asset_id + Solana explorer link. **Implementation**: `cert/destroyed_render.ts` helper exports `renderBurnedDeedResponse(req, image)` returning the 410 + stub if anonymous, the owner-context payload if the requester owns the deed. **Court-order operational override**: if a specific court order requires literal public-facing language, the audit row's `compliance_actions_taken` JSON carries the override string and the helper reads it. **Why universal**: per-reason branching at the render layer leaks information (a 451 vs 410 status reveals "this was a legal action"). |
| PM-13 | **Per-deed configurable royalty + recipients.** MVP fixes `royalty_pct = 10` and a single creator beneficiary at 100%. Post-MVP: creator-configurable `royalty_pct` per listing (with a platform-set ceiling/floor); split among multiple recipients (creator + collaborator + label) summing to 100%. Schema rows in §1.1 already accommodate variation; the change is at the listing-flow UI + Card 3 SAL props (the buyer signs the per-listing royalty value rather than a platform constant). Lands alongside resale activation when the broader rights-configurability surface ships. |
| PM-14 | **Multi-edition tiers.** MVP fixes `edition = "Unique (1 of 1)"`. Post-MVP: Limited editions (`N of M`) with explicit slot allocation + provenance disclosure, and Unlimited prints. Touches: edition slot allocation logic (deterministic per-deed slot id), SAL props_schema gains a tier indicator, and the Bubblegum mint surface ships one cNFT per edition slot under a shared collection. Lands with the broader rights-configurability surface. |

## 7. Cross-References

| Doc | Relation |
|---|---|
| [arweave_master.md](arweave_master.md) | Encryption + Arweave Master upload subsystem; provides `arweave_uri` + `sha256` + `phash` as dispatch inputs |
| [workflows/deed_wsd.md](../workflows/deed_wsd.md) | Workflow sequence (Card 5 issue-deed) |
| [/docs/commerce/run_image_ops.md](../commerce/run_image_ops.md) | Caller (step e of the buy pipeline) |
| [/docs/cert/esign.md](../cert/esign.md) | SALES_AGREEMENT signing_event_id sources (both creator and buyer sides) + COA signing_event_id + MJA + CMA pointers |
| [/docs/cert/crypto.md](../cert/crypto.md) | `buildEncFinal` / `buildEncFinalUnwrapped` / `decryptMaster` helpers |
| [/docs/registry/post_mint.md](post_mint.md) | `applyMintSucceeded` -- inserts Deed row, flips Image to sold |
| [/docs/registry/wallets.md](wallets.md) | Magic-provisioned buyer wallets |
| [/docs/r62_r71_alignment.md](../r62_r71_alignment.md) | Pending R62 + R71 spec-text edits that follow from this subsystem's operative architecture |
| [ADR-0001](../adr/adr_0001_buyer_triggered_build.md) | Build dispatch decoupled from Stripe webhook |
| [ADR-0005](../adr/adr_0005_phash_in_deed_and_uniqueness_gate.md) | phash in deed + uniqueness gate |
| [ADR-0007](../adr/adr_0007_buyer_friendly_retry.md) | Buyer-friendly retry model -- sweeper retries dispatch |
| [ADR-0008](../adr/adr_0008_self_mint_bubblegum_v2.md) | Self-mint Bubblegum V2 architectural decision + alternatives considered |
| [D-16](../divergences.md) | cNFT `image:` URL points at Cloudinary directly while `epimage.com` is not yet hosted |
| [D-18](../divergences.md) | `Deed.enc_final_unwrapped` seal-break side effect on `/download-master` |
| [D-19](../divergences.md) | Arweave Master is packaged as `<image_id>.zip` (single-layer ZIP-AES-256); platform proxy `/a/:imageId` serves it with a friendly filename |
| R62 §1.5 | Storage Model -- Master Storage row (Arweave-bound `enc_final`); the deed as receipt |
| R62 §2.3 | doubly-nested `enc_final` encryption + order rationale |
| R62 §3.5.1 | deed_state machine + seal-break semantics |
| R62 §4.5 / §3.5 | Resale workflow (post-MVP) |
| R62 §7.4 | Storage Model overview |
| R71 §2.4 step 14 | Card 5 mint step (authoritative for MVP buyer flow) |
| R71 §3.7 | Vendor list (DAS-RPC providers) |
| R72 §2.9 | Identity verification (owner wallet sign-message) |
| Constitution INV-01 | The image is the asset; the deed is the receipt |
| Constitution INV-06 | 3-of-5 multi-sig for disputed / void (MMP-procedural) |
| Constitution INV-10 | deed_state transitions total -- enforced via tree authority + audit log |

---
*Last Updated: 26/06/12 18:00*
