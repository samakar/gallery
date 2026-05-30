# Gallery Protocol

---

## SUMMARY

This report specifies the Decentralized Master Licensing protocol, a digital ownership infrastructure where creators mint encrypted high-resolution Master Images, sell them as authenticated digital images through the Digital Gallery, and buyers acquire exclusive personal use, public display, and resale rights. The image is the asset that is sold; the on-chain deed is the ownership instrument that records and enforces those rights, not the asset itself. The protocol solves the symbolic-ownership failure that destroyed $40+ billion in NFT value by binding the deed to encrypted Arweave custody and authenticated gallery display.

Gallery decomposes into three functions arranged on a durability axis: **Certification** and **Commerce** form the Gateway tier (live, platform-operated, mutable; Web2); **Registry** is the permanent, decentralized tier (Web3: deed on Solana, Master on Arweave, image-ID, and Magic-provisioned wallet).

Specifications cover product definition, platform ownership architecture, the Digital Gallery (discovery, glass-box display, primary and secondary sales, gifting), reproduction and distribution extension, the quality gate, and technical architecture.

Behavioral foundations are documented in R67 (Gallery Design) §3. Market sizing, competitive positioning, and product-market fit analysis are documented in R66 (Gallery PMF). Appendix A specifies the Digital State Museum premium tier.

---

## 1. BACKGROUND AND CONTEXT

This report specifies the Decentralized Master Licensing Protocol across six areas: (1) product definition; (2) platform ownership architecture; (3) the Digital Gallery Platform; (4) reproduction and distribution; (5) the quality gate; (6) technical architecture.

Legal architecture is intrinsic to protocol design, not external commentary. Deed structure, license terms, contract acceptance flow, DMCA-compliant takedown, securities-compliance product features, and FTC franchise treatment are features of what is built. R62 is a transactional protocol where the contracts and compliance features are the product, distinguishing it from infrastructure-only specifications (R45, R30, R29) that reference the legal cluster (R42, R58) externally.

Gallery decomposes into three functions arranged on a single durability axis. The axis separates live, platform-operated, mutable state (Gateway) from permanent, decentralized state (Registry). Gateway comprises two functions; Registry is one.

| Function | Tier | Scope | Mutability |
|---|---|---|---|
| Certification | Gateway | Identity verification, content authentication, ESIGN clickwrap, trust-maintenance (takedown, forensic attribution) | Live, platform-operated, mutable |
| Commerce | Gateway | Transaction surface, variant production, operational custody, protected render, CDN delivery, all watermarking, fulfillment, analytics | Live, platform-operated, mutable |
| Registry | Permanent | Deed (Solana pNFT), Arweave-bound Master Image, image-ID, Magic-provisioned Solana wallet primitive | Permanent, decentralized |

The mapping is **Gateway = Web2**, **Registry = Web3**. Every Web3 primitive in the system (Solana, Arweave, wallet, Crossmint, the on-chain doubly-nested encryption `enc_final`, the post-cessation trustee key-release path) consolidates under Registry. Every Web2 surface (web upload, OAuth, Stripe, Cloudinary, image processing pipeline, server-side image custody, content moderation) consolidates under Gateway.

---

## 2. PRODUCT DEFINITION

### 2.1 Certification

Certification is the Gateway trust-establishment function. It composes four mechanisms: (1) creator and buyer identity verification (consumer-tier via OAuth at first purchase; seller-tier with KYC at first listing or first resale-listing), (2) content authentication via the §6 ingestion gates, the on-chain content-hash anchor (§7.4), and the image match engine (§6.2), (3) ESIGN-compliant clickwrap acceptance of legal contracts -- CMA, MJA, ISA, and per-image License Acceptance -- specified in §3.4, and (4) trust-maintenance: inbound takedown dispatch (§4.9) and forensic attribution (Appendix E). Certification is pure analysis and admission or rejection.

**Image Verification.** Image verification operates as two distinct operations, both grounded in the image match engine (§6.2) and the on-chain sha256 anchor (§7.4):

| Operation | When | Goal | Mechanisms |
|---|---|---|---|
| Ingestion verification | At upload, before mint | Decide whether to admit this Master into the system | §6.1-§6.9: local checks, uniqueness, sole-copy, synthetic-content detection, reverse-image search, right-of-publicity, moderation, malware, grading |
| Post-mint verification | After mint, anywhere in the wild | Identify whether a candidate image is authentic Gallery emission and from which deed | sha256 check + image match engine -> 4-state verdict |

### 2.2 Commerce

Commerce is the Gateway transaction-and-fulfillment function. It composes the live, platform-operated mutable surface of the protocol: (a) the transaction surface (primary sales, resales, payment processing, on-ramp, physical product integration, analytics), (b) variant production and operational custody (the Original in server-side encrypted custody as the canonical workhorse; the five image variants composed from it on demand), (c) all image manipulation (PREVIEW overlay on the Listing preview, in-pixel URL text on the Share Copy and Keepsake Copy, per-owner monogram, future invisible forensic watermark when deployed; Certification performs no pixel modification), (d) protected render (§7.5 decryption and rendering architecture), and (e) CDN delivery (Cloudinary asset pipeline). Commerce consumes the image-ID generated by Certification at admission and owned by Registry; the Magic-provisioned Solana wallet is a Registry primitive used here as the buyer-side recipient of mint at Card 5 and as the encryption target for `enc_final`'s inner layer.

Commerce produces and governs five image variants from a single creator-uploaded Master. Each variant has distinct access tier, composition, and use case. The customer-facing abstraction is **Master Image + Keepsake Copy + Share Copy**: Master Image is the encrypted full-resolution canonical instance, Keepsake Copy is a creator-opt-in mid-fidelity variant for small physical applications, and Share Copy is the share-fidelity variant for social propagation. Listing preview and Thumbnail serve discovery surfaces. The four-layer (Idea / Image / Storage / Substrate) framework these variants operate within is R67 §4.1; every variant below is a Storage-layer instance of the same Image.

| Variant | Access | Composition | Use Case |
|---|---|---|---|
| Master Image | Deed holder (§7.5); server-side for fulfillment | Full-resolution canonical instance; three forms (see Variant detail) | One-click print fulfillment; deed-holder download (mutates deed state) |
| Keepsake Copy | Deed-holder download (§7.5); creator-opt-in per image | Smaller-than-Master JPEG + monogram + URL text + XMP/IPTC metadata; high quality at its scale | Small physical applications (mug, badge, small framed print) and high-quality phone wallpaper |
| Share Copy | Deed-holder download; public image-page render (public/private toggle) | 1080px JPEG + monogram + visible in-pixel URL text + metadata, Instagram-optimized | Social sharing, image-page public preview, share-mediated distribution |
| Listing preview | Public (pre-sale) | 1080px JPEG + creator credit + centered italic "Epimage" watermark, Instagram-optimized | Creator Page grid and pre-sale listing page; travels via creator-shared social posts |
| Thumbnail | Public | Low-resolution preview | Discovery surfaces, image-page card, social preview |

**Variant detail.**

- **Keepsake Copy** -- 8-bit sRGB; typical sizing in the 2400-3600px range, independent of the Master's print size (a creator selling 8x12 prints may still offer a 4x6 keepsake for mug or badge applications). Generated at Card 6 personalization when enabled at upload, cached per `(deed, owner)`; does not exist between Card 5 mint and Card 6. The edition number is appended to the monogram on download. The monogram is owner-discretionary at Card 6 (Default, Override, or None) only if the creator enabled it at upload; otherwise Default or Override only. Licensed strictly for non-commercial personal display under the per-image License Acceptance.
- **Share Copy** -- the universal deed-bound variant; every image has one by default. Generated once per `(deed, owner)` pair at Card 6 personalization and cached for repeated delivery; does not exist between Card 5 mint and Card 6. Additional Share Copies for commercial reproduction require creator-enabled reproduction rights (§5.1) and incur the wholesale royalty (§5.3).
- **Thumbnail** -- preserves the Original's aspect ratio (no cropping). Long edge bounded to a fixed display size (per R71 implementation). No watermark, no creator credit, no monogram. Discovery surfaces fit the Thumbnail within a common square bounding box via CSS `object-fit: contain` (longest dimension matches the box; shorter dimension shows letterbox or pillarbox space). The Thumbnail is also the canonical anchor for non-destructive pHash verification.

The four composition layers below describe the maximal stack:

**Listing preview watermark composition.** The Listing preview's visible "Epimage" watermark is composed via Cloudinary at variant build (Card 2) with the parameters below; rationale in R67 §5.17. Per-image identification and acquisition routing are carried by the in-pixel URL text on circulating variants, not by this watermark.

| Parameter | Value |
|---|---|
| Typeface | EB Garamond Italic Regular (Google Fonts) |
| Text | "Epimage" (title case) |
| Placement | Centered (both axes), single instance, not tiled |
| Size | 12-18 percent of image width (tune by eye at build) |
| Rendering | Outline only via `e_outline:inner`; fill transparent |
| Stroke width | 0.5 to 0.8 px |
| Opacity | 4 to 6 percent |
| Tracking | Slightly increased letter-spacing |
| Color | Black, or a screen blend mode that adapts to image tonality |

Illustrative Cloudinary transformation:

```
l_text:EB+Garamond_36_italic:Epimage,co_transparent,e_outline:inner:1:0,co_black,g_center,o_5,letter_spacing_3,fl_layer_apply
```

| Layer | Purpose |
|---|---|
| Resized Master Image | Rendering of a resized derivative of the Original at display / print resolution; the Original remains in server-side encrypted custody. Every Keepsake Copy, Share Copy, Listing preview, Thumbnail, and platform-delivered Master Image is composed from the Original on demand; the on-Arweave Master Image is reserved for the post-cessation per-owner recovery path only |
| Monogram | Visible identity-expression text block, selected at Card 6 personalization. **Default** -> owner initials plus creator name (preselected, requires only confirmation); **Override** -> owner-specified custom text; **None** -> no visible monogram. Per-variant option rules are in the Text elements table below. The decision is required to complete personalization; once submitted it is immutable for this `(deed, owner)` pair to preserve single-version artifacts. Full artist credit ("[Title] by [Creator], [Year]") and acquisition metadata remain in the metadata layer regardless of monogram selection. On resale, the new owner makes their own Card 6 monogram decision against freshly-generated Keepsake Copy and Share Copy bound to their wallet |
| Metadata | Keepsake Copy number, mint date, on-chain deed address (Solana mint address; canonical, registrar-independent), deed URL (convenience pointer to Gallery verification page), content hash (SHA-256 of the secured image, enables hash-match verification), and embedded XMP / IPTC provenance metadata for human-readable inspection |
| URL text | Resolves to the Gallery image page; rendered in-pixel as visible text (not in file metadata) so it survives social-platform re-hosting and metadata stripping; detected by iOS Live Text and Google Lens on long-tap. Always present on the Share Copy (non-removable). Present by default on the Keepsake Copy; suppressible by the owner only when the creator enabled owner-discretionary URL placement at upload |

**Monogram typography.** Design rationale -- the artist-signature and collector-mark provenance conventions the monogram draws on, and why it uses a soft shadow rather than the §7.6 hard OCR stroke -- is in R67 §5. Spec: the monogram is set in a single restrained, neutral, image-deferential typeface in the gallery-wall-label register (a quiet neutral grotesque or a restrained text serif), sized small and low-contrast; display, brand, script, and calligraphy faces are prohibited. It is rendered in one fixed warm off-white (not pure white, not black) at roughly 75-85% opacity, with a soft low-opacity dark drop shadow carrying legibility over variable-luminance backgrounds. The monogram is human-read; the §7.6 URL-text OCR contract does not govern it. Capturing the creator's actual signature as an onboarding asset is a candidate for a later release.

**Monogram sizing.** The Share Copy is rendered at 1080px wide (the social-platform native feed width per §7.6; the platform downscales anything wider). Cap-height is set per variant, because the Keepsake Copy and Share Copy differ in pixel size and the monogram is composed after resize. On the Keepsake Copy (a small-print or mid-fidelity-display artifact), cap-height is a fixed physical height: at 300 DPI a restrained print credit is roughly 0.15 to 0.2 inch, fixed in physical size on every print regardless of print dimensions. On the Share Copy (a phone-screen artifact, physical inches undefined), cap-height is roughly 2.5 to 3 percent of Share Copy width, about 27 to 32px on the 1080px Share Copy, with a legibility floor near 22px below which it degrades to unreadable fine print. These figures are starting points; the binding test is empirical -- render the Share Copy, pass it through real platform recompression, and confirm phone legibility.

**Text elements: Keepsake Copy and Share Copy.** The two customer-facing copy variants carry two in-pixel text elements -- the monogram and the URL text. Their specifications consolidated:

| Element | Keepsake Copy | Share Copy |
|---|---|---|
| Monogram | Present by default (Default or Override at Card 6). Restrained gallery-register typeface (neutral grotesque or restrained text serif); warm off-white at ~75-85% opacity with a soft drop shadow; recessive, defers to the image. Cap-height = fixed physical height at 300 DPI (~0.15-0.2 in). Owner may choose None only if the creator enabled owner-discretionary monogram at upload | Always present (Default or Override at Card 6; None disallowed). Same typeface and treatment as the Keepsake Copy; recessive. Cap-height ~2.5-3% of width (~27-32px on the 1080px Share Copy) -- a phone-legibility floor for a careful human look |
| URL text | Present by default. If suppressible (creator enabled owner discretion), suppression is owner's Card 6 choice. Rendered per the §7.6 contract; cap-height by the 300-DPI physical-height logic | Always present (non-removable). Rotated 90°, lower-right; IBM Plex Mono, Medium/Semi-Bold; fixed light fill + fixed ~2px dark stroke. Cap-height ~3-4% of width (~32-43px), ~30px floor. Full opacity -- a visible authenticity signal, not recessive |

Full rendering contracts: the monogram in the Monogram typography and Monogram sizing notes above; the URL text in §7.6.

**Transaction surface.** Gallery (canonical) is the centralized transaction surface where deed minting, payment settlement, and resale matching occur. Optional embeddable checkout extends the surface to creator-owned websites and Linktree pages. Marketing surfaces remain external (creator-controlled audience-engagement channels per R66 Section 2.2); the transaction surface itself is centralized because per-buyer authentication, deed issuance, and resale royalty enforcement require Gallery's backend. The institutional scope is a marketplace operator delivering authentication, custody, settlement, and resale enforcement, equivalent to Heritage Auctions, RR Auction, and PSA/JSA, none of which require cooperative or DAO governance to deliver their products. Email delivery of the COA / Title Document / Purchase Receipt / per-image License Acceptance package at every transaction is documented in §3.4 Email Delivery.

**Payment and on-ramp.** Stripe Connect and Zero Hash on-ramp; settlement flows through the multi-recipient smart contract for primary, secondary, and co-branded routing.

**Physical product integration.** Optional one-click print fulfillment routes physical renderings of the master through partner APIs (e.g., Printful Embedded Design Maker), enabling the buyer to produce print, canvas, mug, garment, phone case, or other physical instances directly from the image page. Each physical rendering is buyer-initiated under the rendering license (Section 5.1-5.3) and produces a creator royalty per Section 5.3. Gallery captures no incremental revenue beyond the creator royalty; the integration is a buyer convenience that monetizes through royalty flow rather than fulfillment markup.

**Analytics.** Per-deed dashboards covering image-page views, widget impressions, share-event signals, and URL-resolution events across the cross-platform discovery surface. Tracking primitives (per-share short URLs, click-through tracking, event-stream capture) use established services (Branch.io-class smart-link, PostHog or Segment-class event capture, Pusher or Supabase Realtime-class push); Gallery's contribution is the aggregation layer and on-chain attribution. Co-brand partners receive scoped views with metrics calibrated to limited-edition-event valuation: launch-window image-page traffic, share velocity during the drop window, secondary-listing activity, mention density, and post-event sustained interest. Detailed analytics architecture in R37.

### 2.3 Registry

Registry is the Web3 / permanent / decentralized function. It owns every primitive whose durability, uniqueness, or post-cessation-recoverability requirements exceed what a live, platform-operated tier can supply: the on-chain deed (Solana pNFT), the Arweave-bound Master Image (the deed-bound archive), the canonical image-ID, and the Magic-provisioned Solana wallet primitive. Registry consolidates all Web3 primitives in the system per the §1 durability mapping (Gateway = Web2, Registry = Web3). Registry has no pixel-modification surface; all variant builds (Original-derived Keepsake Copy, Share Copy, Listing preview, Thumbnail, platform-delivered Master Image) are performed by Commerce.

**Deed.** The deed is the on-chain ownership-record instrument. The image is the artifact; the deed is title plus certificate of authenticity unified in a single on-chain record. The card-sequenced issuance procedure is in §3.1 Card 5; tier-handling protocol mechanics are in §3.3 (legal framework -> 17 U.S.C. §202, UCC Article 12 controllable-electronic-record status, AI-generated / Public-Domain / Third-Party-Licensed resale-right tiers -> in R67 §6.2, §6.3, and §6.8); the contract architecture (CMA, BMA, per-image License Acceptance, Creator Image Signing Affirmation, Seller Resale Listing Authorization) is in §3.4; the deed state machine (recording the image's sealed / opened condition alongside deed-lifecycle states) is in §3.5; resale and royalty enforcement are in §4.5. The rendering license under Sections 5.1-5.3 governs print, canvas, mug, garment, phone case, and screen-display use, with creator royalties on every physical rendering per Section 5.3.

**Edition tiers.** Set at mint. Each tier specifies the number of deeds bound to a single Master Image on Arweave:

| Tier | Edition Size (deed count) | Scarcity | Resale Market | Use Case |
|---|---|---|---|---|
| Unique | 1 deed | Maximum | Strong | Premium creator-collaboration deeds, signature artworks |
| Limited | 50-500 deeds (creator-set) | Strong | Strong | Mid-tier collectibles; canonical commercial pattern |
| Unlimited | Unbounded deed count (fingerprinted) | Absent | Weak | Fan-support tokens, low-priced content, promotional drops |

**Deed-storage mapping.** Edition tiers determine the deed-to-storage cardinality. The Master Image on Arweave is a single canonical instance; the deed count above governs how many deeds bind to that single Master Image. Aligned with the R67 §4.3 framework:

- *Unique (1-of-1):* one deed, one Master Image on Arweave, 1-to-1 mapping. The deed-holder may break the image's seal to download the Master Image; once broken, the image is opened and platform-mediated resale is permanently disabled (§3.5). R71 MVP scope.
- *Limited (N deeds, one Master Image):* N deeds bind to one Master Image on Arweave at distinct edition slots (1/N, 2/N, ..., N/N). Each deed is independently transferable, and each deed's image is independently sealed / opened; each deed carries its own owner-specific cached Keepsake Copy (when creator-enabled) and Share Copy with the edition number embedded in the monogram. Each deed-holder may independently break their image's seal to access the shared Master Image; the Arweave bytes persist for the remaining deed-holders. Print fulfillment via Gallery print partner is per-deed (one print right per deed slot, edition number embedded in the print, e.g., "7/25"). Edition slots are allocated at sale time by default; the creator may reserve specific slots (e.g., artist proofs or self-collection) at the configuration stage. Storage scarcity is logical, not physical: many-to-one at the Master Image layer, one-to-one at the edition-slot layer. MMP+ scope.
- *Unlimited (unbounded deeds, one Master Image):* deed count is open-ended; per-deed fingerprinting (visible edition number + content-uniqueness anchor) preserves per-deed identity but scarcity is absent at the artifact class. Fan-support tier, intended to be priced low and bundled with the creator's other monetization (R66 §K.2). Each deed still carries owner-specific cached variants with the deed-sequence number in the monogram. MMP+ scope.

In all three tiers, the deed (not the Master Image storage instance) is the per-buyer scarce object; the Master Image is referenced by deed metadata as a shared URI. The convention mirrors limited-edition photography exactly (one negative -> N numbered prints). R71 MVP implements Unique only; Limited and Unlimited tiers are MMP+ scope.

**Co-branding.** Co-branded deeds support dual-attribution at mint with shared royalty split via the §3.5 multi-recipient smart contract; the second party may be a charity, thought leader, celebrity, peer creator, or brand. Cause-attributed brand drops route a portion of proceeds to a charity via smart contract.

**Arweave-bound Master Image.** The on-Arweave Master Image is built once at Card 5 from the Original (which lives in Commerce operational custody) by encrypting a working copy with the per-image `DEK_image` and uploading to a single Arweave URI. At Card 5 the doubly-nested encryption `enc_final = encrypt(encrypt(DEK_image, owner_wallet_pubkey), platform_DEK)` is constructed and written to deed metadata. On resale the inner wallet layer rotates to the new owner's wallet pubkey via the Metaplex Core UpdateDelegate plugin; the Arweave bytes are immutable for the lifetime of the deed. The Arweave-bound Master is the deed-bound archive reserved for the post-cessation per-owner recovery path (specified in §7.5 Decryption and Rendering Architecture); routine deed-holder downloads of the Master are served by Commerce from the Original (the platform-delivered Master Image), not from Arweave. Security rationale (why the encryption order is wallet-inner / platform-outer; post-cessation key release; mint authority compromise) is R65 §3.14, §3.15, §3.16.

**Image-ID.** The base-36 lowercase image ID (e.g., `abc1d` in the URL `epimage.com/abc1d`) is the canonical artifact identifier, generated by Certification at Card 2 admission and owned by Registry. Commerce consumes it for naming and routing (CDN keys, filenames, in-pixel URL text). The identifier propagates across six surfaces:

| Surface | Form | Purpose |
|---|---|---|
| In-pixel URL text on Share Copy | `epimage.com/abc1d` rendered along the lower-right vertical edge | Visible discovery and verification surface on shared images |
| Downloaded-file filename | `epimage_<youtube-handle>_<owner-ordinal>_<image-id>.<ext>` (e.g., `epimage_examplecreator_1_abc1d.jpg`) | File-system handle on downloaded Keepsake Copy and Share Copy artifacts, self-identifying as to creator and owner |
| Cloudinary asset name | `<image-id>-<variant-code>` (the per-variant `public_id`; see §7.3) | CDN storage and delivery key |
| XMP / IPTC metadata | `image_id` field under the `Gallery` namespace (§3.2) | Embedded provenance field, human-readable in standard EXIF viewers |
| On-chain deed | Metaplex metadata `image_id` field on the Solana pNFT | Source-of-truth canonical record |
| Platform database | Primary key on the image record | Operational lookup index |

The downloaded-file filename embeds, in order, the platform prefix `epimage`, the creator's YouTube handle, the owner ordinal (the current owner's position in the deed's transfer chain, starting at 1), and the image ID, so a saved Keepsake Copy or Share Copy is self-identifying as to platform, creator, owner, and artifact. The on-chain deed is the source of truth; the database mirrors it for operational lookup; the file metadata, filename, and in-pixel URL text carry the ID into channels outside the platform. The same string resolves the same artifact across all surfaces with no translation layer. Design trade-offs documented in Appendix D.

**Deed `image_spec`.** The deed carries a compact `image_spec` block recording the artifact's human-readable technical specification alongside the cryptographic identifiers. The block is extracted automatically from the Original at Card 2 ingestion with no manual creator entry, written to deed metadata at Card 5 deed mint, and surfaced in the COA package (§3.4). The design rationale (convention precedent, print utility, per-field justification, exclusion principle) is in R67 §5.14. The canonical schema is seven fields:

```json
{
  "image_spec": {
    "width_px": 4032,
    "height_px": 3024,
    "color_space": "Display P3",
    "icc_profile": "DisplayP3.icc",
    "color_depth_bits": 24,
    "file_type": "HEIC",
    "file_size_bytes": 3145728
  }
}
```

| Field | Type | Source |
|---|---|---|
| `width_px` | integer | EXIF / header pixel width |
| `height_px` | integer | EXIF / header pixel height |
| `color_space` | string | Embedded ICC profile description, else the color-space EXIF tag |
| `icc_profile` | string | Embedded ICC profile name; `sRGB` only when no profile is embedded |
| `color_depth_bits` | integer | Bits per pixel summed across channels (e.g., 24 = 8-bit RGB) |
| `file_type` | string | Container and codec of the uploaded Original |
| `file_size_bytes` | integer | Byte length of the uploaded Original |

**Extraction.** The block is read at Card 2 ingestion from the Original's embedded metadata using ExifTool [exiftool-nodate] or, equivalently, Python Pillow [pillow-nodate] or the ImageMagick `identify` utility [imagemagick-nodate]. The platform reads the actual embedded ICC profile rather than assuming one, defaulting `color_space` and `icc_profile` to sRGB only when no profile is present. Phone-sourced uploads populate every field natively from EXIF -- an iPhone HEIC carries Display P3, 8-bit-per-channel depth, and pixel dimensions directly. The embedded DPI / resolution tag is ignored because DPI is a print-time decision, not a file property (R67 §5.14 exclusion principle). The block is computed once from the immutable Original and is not regenerated from variants, which strip embedded metadata during composition (§3.2).

**Deed `sale_record`.** The deed records the consideration paid at each transfer as on-chain provenance, consistent with the conveyance-instrument convention (rationale in R67 §5.15). One entry is written at primary sale (Card 5) and one at each resale (§4.5); each entry carries the amount, currency, transaction timestamp, and on-chain transaction hash. The Title Document already records this price (§3.4); this block formalizes its on-chain placement. The canonical schema is an append-only array:

```json
{
  "sale_record": [
    {
      "event": "primary",
      "amount_minor": 450000,
      "currency": "USD",
      "timestamp": "2026-05-28T15:35:00Z",
      "tx_hash": "5Hk...c1d"
    },
    {
      "event": "resale",
      "amount_minor": 600000,
      "currency": "USD",
      "timestamp": "2026-08-14T09:12:00Z",
      "tx_hash": "9Qm...4ab"
    }
  ]
}
```

| Field | Type | Source |
|---|---|---|
| `event` | string | `primary` at Card 5 mint; `resale` at each §4.5 transfer |
| `amount_minor` | integer | Gross sale price in ISO 4217 minor units (e.g., US cents); the same figure the §4.5 resale royalty is computed against |
| `currency` | string | ISO 4217 alphabetic code of the settlement currency |
| `timestamp` | string | RFC 3339 UTC timestamp of the settled transaction |
| `tx_hash` | string | On-chain transaction hash of the deed transfer |

The block is append-only: existing entries are immutable and each transfer appends one entry, so the full price history reconstructs from the deed alone. It is written to on-chain deed metadata and is deliberately not embedded in the circulating image file's XMP layer (§3.2), keeping the consideration on the record without baking a price into shareable copies.

**Display prohibition.** The `sale_record` is readable from the on-chain deed and the Title Document by anyone who queries them, but the platform UI must not aggregate it into a price-performance surface. Browse, owner-collection, and public-display surfaces must not render price charts, floor-price displays, last-sale banners, or portfolio-value or appreciation analytics from `sale_record` data. This enforces the Prong 3 profit-expectation safeguard (R67 §6.6 safeguard #2: resale history shows provenance, not profit) and implements the record-but-do-not-foreground discipline (R67 §5.15). The image page may surface the provenance chain (parties, dates, transfer events) without foregrounding price movement as a salient element.

**Wallet primitive.** Every Gallery user (creator and buyer) is provisioned a Solana keypair via Magic SDK at first authentication. The wallet is a Registry primitive because it is the mint recipient at Card 5, the encryption target for the inner layer of `enc_final` (so that only the wallet's private key can complete decryption after `platform_DEK` is published at cessation), and the post-cessation unwrap key for the Arweave-bound Master Image. Magic abstracts the keypair behind email / OAuth login for the buyer-side UX (consumer-tier wallet, OAuth at first purchase) and behind email / OAuth plus KYC for the seller-tier wallet (creators at first listing, sellers at first resale-listing). The wallet's transfer surface (resale, gifting, account lifecycle) is governed by §3.5 deed mechanics and §4.10 account-lifecycle policy.

---

## 3. PLATFORM OWNERSHIP ARCHITECTURE

### 3.1 Authentication and Ownership Procedure

This section addresses the authentication problem -- who created the asset, who owns it, and how is that recorded -- complementary to the protocol's authorization layer (copy control and access control). The protocol solves authentication through ID verification and the NFT deed: a record on the Solana blockchain that holds two signatures -> the creator's wallet address (permanent, never changes on resale) and the owner's wallet address (updates on each transfer). Identity verification (YouTube OAuth, credit card, bank account) establishes that each wallet address belongs to a verified person before either signature is recorded. The per-asset journey runs through eight sequential cards (Card 1 Certify, Card 2 Image Creation, Card 3 List, Card 4 Purchase, Card 5 Deed, Card 6 Personalization, Card 7 Ongoing Access, Card 8 Resale Transfer), preceded by once-per-person Identity Verification. Cards 1-3 form the creator upload workflow, Cards 4-6 the buyer purchase workflow, and Cards 7-8 ongoing access and optional resale; this card structure is the same as that used in the customer-facing image-journey diagrams.

| Stage | Action |
|---|---|
| Pre-Journey: Identity Verification | Both creator and buyer complete identity verification before transacting. Creator passes three layers: YouTube OAuth (channel ownership), credit card verification (legal identity), and bank account verification (business identity). Buyer passes credit card verification. Identity verification is once-per-person, executed at signup; it precedes and is separate from the per-asset 6-card journey. No anonymous party can mint or purchase. |
| Card 1: Certify | Creator uploads the high-resolution Original to staging storage. Platform validates local quality (resolution, color depth, format, file size floor) and runs the §6 ingestion gates (uniqueness, authenticity, RoP, moderation, provenance, malware, grading). Creator then completes the per-image ESIGN affirmation and accepts the Sole Copy Agreement (§6.3). |
| Card 2: Image Creation | Platform generates the 5-char base-36 image ID (§2.3) as the first action of this card and binds it to the Original. Platform generates `DEK_image` (per-image AES-256 data encryption key), encrypts it under the platform-wide envelope key `platform_DEK` to form `encrypt(DEK_image, platform_DEK)`, and persists the encrypted form alongside the encrypted Original. The Original is encrypted with `DEK_image` and persisted to server-side storage as the canonical workhorse for every future variant build (see §2.2 Master Image storage; security rationale in R65 §3.14). Platform extracts the `image_spec` block (§2.3) from the Original's embedded metadata at this card (deed-metadata write deferred to Card 5). From the Original, the platform composes the Listing preview and Thumbnail (delivered through the CDN per §7.4 -- not on-chain-anchored; verification routes through the off-chain match engine §6.2) and embeds XMP / IPTC provenance metadata on the public variants (deed fields null pending Card 5). No on-Arweave Master, no deed, and no Arweave upload at this card; all three are deferred to Card 5. The Original is never modified. |
| Card 3: List | Creator enters title; a required first-person description entered via a guided prompt and validated against a minimum-length bar before the listing can go live (§3.2; rationale in R67 §5.16); creation date; category / tags; an optional context-video URL; and a fixed price. Listing record is created (staging URL, content hash, signing_event_id, deed address null until Card 5); image goes live on the Creator Page grid. Creator shares the listing link. |
| Card 4: Purchase | Verified buyer pays in fiat via Stripe Elements, signs the per-image Buyer License Acceptance (distinct from the signup-time BMA -> the BMA covers platform-relationship terms once, the per-image License Acceptance covers the specific creator-buyer rights grant which varies by image), and revenue distributes 90/10 via Stripe Connect. |
| Card 5: Deed | Platform builds the on-Arweave Master from a working copy of the Original: encrypts the working copy with the same `DEK_image` used at Card 2 to encrypt the Original. Uploads the encrypted Master to Arweave at a single URI. Constructs the nested on-chain ciphertext: inner = `encrypt(DEK_image, buyer_wallet_pubkey)`; outer = `encrypt(inner, platform_DEK)`. Issues the deed directly to the buyer's wallet via the Crossmint API (single-step deed issuance), embeds the Arweave URI, the nested `enc_final`, the `image_spec` block (§2.3), and the primary `sale_record` entry (§2.3) in deed metadata, binds the deed to the content hash, and emails the COA package to both parties (the COA certifies the Original and the deed; it is independent of Card 6 personalization). Platform records the Master variant sha256 `{M: sha256(M_pixels)}` to deed metadata via mint-authority Solana transaction as part of deed issuance; deed metadata absorbs the prior Card 2 image-id variant-hash records. **Image visibility is initialized to `images.visibility = 'private'` at deed issuance (Vault mode by default per §4.7); the buyer holds the Share toggle to flip to public.** The cached Keepsake Copy and Share Copy do not yet exist at end of Card 5. The Original remains in server-side encrypted custody as the canonical workhorse for every future variant build. |
| Card 6: Personalization | Owner returns to the image page, makes the required monogram decision (Default = owner initials + creator name; Override = custom text; None = no monogram per §2.2). The platform decrypts the Original from server-side custody and composes the canonical Keepsake Copy (when creator-enabled at upload; monogram and URL text present by default, with optional creator-set owner discretion per §2.2) and Share Copy (monogram and URL text always present) once per (deed, owner) pair. Platform records `{E: sha256(E_pixels)}` to deed metadata via mint-authority Solana transaction; the Share Copy is a public-circulation variant delivered through the CDN and is not on-chain-anchored per §7.4. The Keepsake Copy (when present) is cached server-side (encrypted at rest with `DEK_image`); the Share Copy is served via CDN. Both surface in the buyer's Collection; the Original is unchanged. |
| Card 7: Ongoing Access | Deed holder downloads the cached Share Copy and, where creator-enabled, the cached Keepsake Copy (§2.2 Commerce, §7.5 Decryption and Rendering Architecture); public viewers see the Share Copy via the public render. The buyer can download the Share Copy, the Keepsake Copy (if creator-enabled), or the raw Master. Master download is platform-mediated and cryptographically enforced: the buyer authenticates with wallet signature, platform decrypts `DEK_image` from `platform_DEK` and delivers the Master, the image transitions from sealed to opened (permanently disables resale per §3.5; recorded as `deed_state`), and the platform builds variant `M+N` (owner ordinal = N) and records `{M+N: sha256(M+N_pixels)}` to deed metadata via mint-authority Solana transaction. The owner has no offline self-decrypt path during operational life; all Master access goes through the platform-mediated release flow. Corresponds to slide step 7 DOWNLOAD. |
| Card 8: Resale Transfer | NFT deed's owner address updates on-chain to new buyer via the §4.5 resale workflow. The Arweave Master URI, the Arweave bytes, and the platform-side operational copy in S3 metadata are all unchanged. The on-chain nested encryption is re-built to bind to the new owner: platform decrypts `DEK_image` from the operational copy via `platform_DEK`, constructs the new inner ciphertext `encrypt(DEK_image, new_buyer_wallet_pubkey)`, re-applies the outer `encrypt(inner, platform_DEK)` layer, and writes the new `enc_final` to deed metadata via the Metaplex Core UpdateDelegate plugin (prior nested encryption invalidated). All rights transfer automatically. Creator receives resale royalty; a `resale` entry is appended to the deed's `sale_record` (§2.3). **Image visibility resets to `images.visibility = 'private'` on transfer (§4.7 Resale reset); the new owner inherits a Vault-mode deed regardless of the prior owner's Share choice.** Previous owner's cached Keepsake Copy and CDN Share Copy become orphaned (deed-ownership check fails); new owner completes their own Card 6 personalization against freshly-generated artifacts built from the Original, which appends a new `{E+N': sha256}` variant sha256 entry to deed metadata for the new owner ordinal (the Share Copy is CDN-delivered and not on-chain-anchored). Corresponds to slide step 8 RELIST. |

**Creator Portfolio Verification (extended identity binding).** The three-layer identity chain establishes who the creator is. Creators with prior published work establish where their work has appeared by linking and verifying authoritative domains and platform handles during onboarding: portfolio domains via DNS TXT-record verification, social-platform handles via platform OAuth where available (Instagram Graph API, X / Twitter OAuth, ArtStation account binding, Behance account binding), and prior creator-platform handles where applicable (Patreon creator authentication, Substack publication binding). Verified domains and handles populate a creator-attribution corpus used by the §6.7 Provenance and Rights Verification Gate to distinguish a creator's own prior work from third-party sources at ingestion. Portfolio verification is optional at first mint but unlocks streamlined rights resolution; creators without verified portfolios face stricter §6.7 ingestion-gate review.

**Creator-account display fields.** Each creator account carries three persistent identity-presentation fields captured at onboarding. These fields display identically across all of the creator's Gallery surfaces (image pages, Creator Page, share metadata) and are creator-editable any time after onboarding with immediate propagation.

| Field | Type | Source | Required | Display |
|---|---|---|---|---|
| `creator_headshot` | Image (square, 512 x 512 px minimum) | Creator upload at onboarding | Required (non-face fallback permitted where the creator declines to show their face, per R67 §5.16) | Creator-presence anchor on every image page (§4.3); Creator Page hero block |
| `creator_bio` | Plain text, 80 to 800 characters, multi-paragraph allowed | Creator entry at onboarding via guided prompt | Required before the first listing can go live | Creator Page hero block (this is the "about me" voice; distinct from the per-image first-person description from §3.2 which is the per-work voice) |
| `creator_channel_url` | URL (HTTPS, verified at OAuth) | Derived from the YouTube OAuth performed at Pre-Journey identity verification | Required (the channel establishes verified creator identity) | Creator Page hero block as external link; image-page creator-presence block as the verified channel link |

**Distinction from the Provenance Verification corpus.** These three display fields are the **public-presentation** layer of the creator account, surfaced on Creator Page and image-page UI. The Provenance Verification corpus above (Instagram, X, ArtStation, Behance, Patreon, Substack handles) is the **ingestion-attribution** corpus used by the §6.7 gate to distinguish the creator's own prior work from third-party sources. The two serve different functions: display fields are minimal and curated, provenance handles are exhaustive and not all surfaced publicly.

### 3.2 Provenance Metadata

Every Master Image carries embedded provenance metadata written into the file header at Card 2 Image Creation using the XMP (Extensible Metadata Platform) standard under a custom `Gallery` namespace, ensuring compatibility with standard image viewers and editing software. Deed-related fields (Deed Address, Original Issuance Date, Transaction ID) are written as null at Card 2 and backfilled at Card 5 when the deed is issued to the buyer. The deed address allows independent on-chain verification of the full provenance chain. The embedded provenance layer provides a human-readable attribution channel (XMP metadata) alongside the machine-verifiable on-chain content-hash anchor (§2.1).

| Field | Description | Source | Required |
|---|---|---|---|
| Creator Name | Verified legal or display name of the original creator | Identity verification (Pre-Journey) | Yes |
| Title | Creator-supplied display name for the work (free text, length-limited) | Creator input at Card 3 List | Yes |
| Description | Creator-written narrative in the creator's first-person voice (artist statement or context for the work; surfaces on the image page bound to the creator headshot per §4.3); minimum-length bar enforced at Card 3 so it conveys meaning rather than a placeholder | Creator input at Card 3 List | Yes |
| Context Video URL | Optional creator-supplied link to a related video (e.g., the video the image accompanies or a behind-the-scenes of the shoot); surfaces on the image page as a restrained new-tab link-out per §4.3; contextual enrichment, not an authenticity anchor | Creator input at Card 3 List | No |
| Current Owner | Display name or ID of the current deed holder | On-chain deed holder record | Yes |
| Original Issuance Date | Timestamp when the deed was first issued to the buyer | Deed issuance transaction (Card 5) | Yes |
| Deed Address | Solana public key identifying the on-chain deed record | On-chain deed record (Card 5) | Yes |
| License Type | Exclusive License version identifier | Platform contract terms | Yes |
| Transaction ID | On-chain transaction hash linking deed to purchase record | Stripe + Solana transaction (Cards 4-5) | Yes |

**Two-layer metadata model.** The provenance fields above are maintained in two layers. The embedded layer is the XMP packet inside the image file: it travels with the file and supports human-readable inspection and independent, offline verification of provenance with no platform dependency. The index layer is the same fields recorded in the platform asset database, supporting search, filtering, and discovery in the gallery interface. The backend writes both layers, and neither is derived from the other at delivery time.

**Embed order and tooling.** Variant composition -- resize, crop, and reframe -- is performed by the image transformation layer, which strips embedded metadata from its derivatives by default to minimize delivered file size. The embedded XMP packet is therefore written as the final step of each variant build, after composition completes. The ordering is deliberate: composition-time stripping discards the creator's original capture metadata, including camera model and GPS coordinates, which the platform does not propagate, leaving the platform to embed only the controlled provenance fields defined above. The packet is written by an in-process backend image library that supports the platform's delivered formats, JPEG and TIFF, and requires no external runtime or command-line dependency; the transformation layer does not itself write custom embedded metadata.

**Why both layers are written explicitly.** Gallery provenance is carried under a custom `Gallery` XMP namespace. Image transformation and asset-management services index only standard embedded schemas, namely EXIF, IPTC, and well-known XMP namespaces such as Dublin Core, and treat fields under a custom namespace as unrecognized data: they are neither returned in the service's metadata response nor added to its search index. The platform therefore cannot populate the index layer by reading the embedded packet back through the transformation service. Because the two layers have no automatic bridge, the backend writes each explicitly, and any provenance field that must be both portable with the file and searchable in the gallery is written twice.

### 3.3 Tier-Handling Protocol Mechanics

The deed records the Master's origin tier in its on-chain metadata. The tier value drives protocol behaviors at the image page, in the mint pipeline, and on resale. Origin classification is performed at ingestion per §6.4 (Content Authenticity Gate) and §6.7 (Provenance and Rights Verification Gate); the legal framework for each tier is in R67 §6.8.

| Tier | Origin Sources | Deed-Page Disclosure | Additional Protocol Behaviors |
|---|---|---|---|
| Captured | Camera capture verified by EXIF / C2PA / reverse-image chain (§6.4) | None required | Standard Exclusive License terms |
| Hand-produced | Human-authored work (illustration, design, painting) | None required | Standard Exclusive License terms |
| AI-assisted | Human-authored work with AI-tool assistance above Thaler threshold | Optional `AI-assisted` tag on image page | Standard Exclusive License terms |
| AI-generated | AI-autonomous output below Thaler threshold | Required: underlying work has no copyright; deed conveys instance ownership; resale value from instance scarcity | None additional |
| Public-Domain | Expired-copyright works, U.S. government works (17 U.S.C. §105), CC0-dedicated works, or otherwise non-copyrighted | Required: underlying work in public domain; basis for PD status (expired / government / CC0 / other); deed conveys instance ownership; resale value from instance scarcity | Per-creator velocity limit applied at §6 ingestion to prevent bulk public-domain reproduction; raised case-by-case for legitimate curation projects (digitized archives, scholarly editions) |
| Third-Party Licensed | CC-BY, CC-BY-SA, paid stock licenses from platform-recognized providers, or custom licenses | Required: license type, attribution requirements, derivative-rights status, commercial-use scope | License document hash-bound to deed at §6.7; license-scope inheritance on resale (CC-BY attribution propagates to each successive holder; non-sublicensable stock licenses restrict resale to platform-mediated transfers within the license scope) |

All tier disclosures are surfaced on the image page pre-purchase and recorded in the per-image Buyer License Acceptance's click-wrap acknowledgment alongside the CMA and BMA version hashes (§3.4). Tier values are immutable post-mint; a misclassified Master cannot be re-tiered without burning the deed and minting a new one.

### 3.4 Contract Architecture

The platform uses a master contract model. Each user signs one agreement at onboarding; individual transactions generate purchase receipts that reference the master contract.

**Creator Master Agreement (CMA).** A single template signed by every creator at onboarding through ESIGN-compliant click-wrap, consistent with *Feldman v. Google* (2007). The CMA covers: copyright warranty (creator warrants ownership and non-infringement of all future uploads), Sole Copy Agreement obligations (Section 6.3), royalty terms, DMCA compliance obligations, content uniqueness commitment (Section 6.2), breach remedies (injunctive relief, actual damages, license termination), graduated penalties (warning, minting suspension, permanent removal, royalty forfeiture), governing law (Delaware), dispute resolution (binding arbitration, AAA Commercial Rules), and license survival (all Exclusive Licenses remain in effect if the platform ceases operations; the cryptographic mechanism that makes this enforceable -- per-image `DEK_image` encryption, the doubly-nested encryption `encrypt(encrypt(DEK_image, owner_wallet_pubkey), platform_DEK)` stored in deed metadata, trustee publication of `platform_DEK` after cessation, and per-owner self-decryption with the wallet key against the residual inner-layer wrap -- is specified in §2.2 Master Image storage and §7.5). The CMA template text is hashed and stored on-chain; when terms update, a new version hash is published.

**Buyer Master Agreement (BMA).** A single template signed by every buyer at signup through the same ESIGN-compliant click-wrap. The BMA covers two scopes: (1) the platform-buyer RELATIONSHIP layer (no-reliance acknowledgment, breach remedies, governing law Delaware, dispute resolution AAA arbitration, license survival across platform discontinuation, takedown-notice acknowledgment per §4.9.4, RUFADAA inheritance and wallet-control disclosure, account-lifecycle acknowledgment per §4.10), and (2) the RESALE FRAMEWORK consent layer (the platform's resale fee policy, the KYC trigger at first resale listing per §4.10.3, the smart-contract delegation framework that the buyer will pre-authorize per-listing at resale, and the license migration receipt issuance authorization). The rights-grant layer (the specific Exclusive License terms for any given Master) is handled separately by the per-image Buyer License Acceptance; the property-transfer authorization at resale is handled separately by the Seller Resale Listing Authorization. The BMA template text is hashed and stored on-chain alongside the CMA.

**Per-Image Buyer License Acceptance.** A per-transaction ESIGN-compliant click-wrap signed at every purchase. The License Acceptance surfaces the specific license terms attached to THIS image -> field of use, territory, term, commercial-use permission, sublicensing rights, derivative-work rights, display permissions, and royalty terms as the creator configured them at mint per §3.3. The two-layer split (BMA at signup for platform-relationship terms, per-image License Acceptance at purchase for the rights-grant) is required because ESIGN consent is term-specific and the creator may grant different rights per image, so a signup-time BMA cannot enumerate an image's license scope; the pattern follows stock photography, app stores, and auction houses. Click event captured with timestamp, IP, browser fingerprint, session token, signing_event_id; the License Acceptance is bound to the deed at mint via the on-chain license-tethering mechanism per UCC Article 12 controllable-electronic-record status (R67 §6.2).

**Creator Image Signing Affirmation (authorship + listing authorization).** A per-image ESIGN-compliant click-wrap signed by the creator at upload. The affirmation combines two functions in a single signing event: (1) authorship attestation on the work (the consumer-facing "creator-signed" claim), and (2) per-image listing authorization for platform-mediated primary sale (the creator's pre-authorization for the platform's smart contract to mint deeds for this work to verified buyers at prices the creator sets, subject to the platform fee schedule and creator royalty terms encoded in the deed at mint). The combined affirmation text is "I sign this work as my own original work, and I authorize the platform to mint deeds for this work to verified buyers on my behalf at prices I set, subject to the platform fee schedule and the creator royalty terms I encode in the deed at mint. [Creator Verified Name], [today's date]". Combining authorship attestation with listing authorization in a single ESIGN event satisfies the UCC Article 12 controllable-electronic-record control-transfer requirement at mint without adding a second click-wrap surface; the creator's wallet signature on the mint transaction at primary sale executes the on-chain transfer. The CMA at signup covers the framework consent (relationship terms, royalty schedule, platform mechanics); the per-image affirmation covers the specific work and per-image listing authorization.

**Seller Resale Listing Authorization.** A per-listing ESIGN-compliant authorization signed by the deed holder at every resale listing (R62 §4.5 Resale Workflow). The Authorization combines a wallet signature on the on-chain listing transaction (the cryptographic ESIGN executing UCC Article 12 controllable-electronic-record control-transfer pre-authorization) with a click-wrap UI rendering the human-readable terms (this specific deed, this specific price or auction reserve, the platform's current resale fee schedule, the creator royalty routing as encoded in deed metadata at mint, the listing duration and withdrawal terms, and the platform's smart-contract delegation that will execute the transfer when a buyer pays). The Authorization is required at every resale listing because the BMA at signup cannot pre-authorize transfers of specific deeds and prices that do not yet exist at signup, and because UCC Article 12 control transfer requires per-transfer authorization from the current controller. Click event captured with timestamp, IP, browser fingerprint, session token, signing_event_id; transaction hash recorded. The seller's per-image Buyer License Acceptance signed at original purchase already establishes the seller's acceptance of the deed's mint-time license terms; the Seller Resale Listing Authorization adds the per-listing transfer-and-price authorization on top.

**Purchase Receipt.** Each transaction (primary sale, resale, license migration) generates a Purchase Receipt referencing: the CMA version hash, the BMA version hash, the per-image License Acceptance signing_event_id, and the NFT mint address of the specific Master Image. The receipt records: both parties' verified identities, transaction hash, timestamp, price, royalty percentage, and the creator-defined license parameters for that Master (as accepted by the buyer in the per-image License Acceptance). On resale, a license migration receipt is generated referencing the new buyer's BMA version, their per-image License Acceptance for the resold deed, and the original creator's CMA version.

**Email Delivery.** The platform delivers two email packages: one at user onboarding, one at every transaction.

The onboarding email is sent to the newly registered party (creator or buyer) and carries the executed master agreement as a PDF attachment -> the Creator Master Agreement for creators, the Buyer Master Agreement for buyers -> alongside the human-readable terms summary, ESIGN consent record, and a record-retention notice.

The COA email is sent to both parties at Card 5 deed mint (and at every resale and license migration). The email certifies the authenticity of the Master and the deed, both of which exist at end of Card 5; it is independent of the downstream Card 6 personalization which produces the derivative Keepsake Copy and Share Copy. The email package is the buyer-facing "Certificate of Authenticity" (COA) bundle and explicitly carries the following attachments:

| Attachment | Contents |
|---|---|
| PDF Certificate of Authenticity | Creator name, title, year, edition number, edition tier (Unique), creation date, mint date, on-chain deed address (Solana mint address), deed URL, content hash (SHA-256 of the secured image), and the creator's per-image ESIGN affirmation signature record |
| PDF Title Document | Bill-of-sale equivalent recording the transfer: parties' verified identities, transaction hash, timestamp, price, royalty percentage, and the on-chain deed reference; serves the title-transfer function unified with COA in the on-chain instrument (§2.3) |
| Purchase Receipt | CMA version hash, BMA version hash, per-image Buyer License Acceptance signing_event_id, NFT mint address, transaction hash, timestamp, price; the three-point evidentiary chain (CMA/BMA version hash + NFT mint address + transaction hash) plus the per-image License Acceptance reference provides court-ready proof of who agreed to what terms for which specific asset at what time |
| Per-image License Acceptance record | The executed click-wrap surfacing the creator's mint-time license parameters (field of use, territory, term, commercial-use permission, sublicensing rights, derivative-work rights, display permissions, royalty terms) and the buyer's ESIGN signature with click-event metadata (timestamp, IP, browser fingerprint, session token, signing_event_id) |
| Personalization access note | The COA email body notes that the Keepsake Copy and Share Copy will be available in the buyer's Collection after the owner completes the required Card 6 personalization decision; the COA itself does not depend on Card 6 |

Email is delivered via Amazon SES; both parties retain the COA package independently of the platform. Email delivery satisfies ESIGN's record retention requirement independently of the platform and creates admissible evidence under state blockchain authentication statutes (e.g., Vermont 12 V.S.A. Section 1913, which establishes a presumption of authenticity for blockchain records). The combination of the on-chain deed (§2.3 -> title plus certificate of authenticity unified in a single on-chain instrument), the explicit COA package retained by both parties, and the three-point evidentiary chain (CMA/BMA + NFT mint address + transaction hash) plus the per-image License Acceptance reference produces a multi-layered authentication record recognizable to courts, auction houses, and downstream resale platforms.

**Reproduction and Distribution Rights (Optional Extension).** The Exclusive License does not include reproduction or distribution rights by default. Creators may separately authorize reproduction rights that allow the Master Owner to generate and sell lower-resolution replicas. This commercial extension is documented in Section 5.1. The separation ensures the core product remains a clean ownership and collecting model, while creators who wish to enable distribution can opt in.

**Creator-Defined License Parameters.** At mint time, the creator configures license constraints that are encoded in the smart contract and enforced by the platform.

| Parameter | Options | Enforcement |
|---|---|---|
| Viewing app display | Public or private default | Viewing app visibility settings |
| Resale royalty | Creator sets percentage | Smart contract on secondary transfer |
| Reproduction rights | Enabled or disabled | Platform-enforced (Section 5 if enabled) |
| Geographic restriction | Global or region-limited | Viewing app gating by viewer location |

---

---

### 3.5 Deed Mechanics

This section specifies the deed state machine and the multi-recipient smart contract referenced throughout §2.2, §2.3, §3.3, §6.5, §6.6, and §6.7.

#### 3.5.1 Deed State Machine

The deed carries a single `deed_state` field that records two layered conditions in one enum: the **image's custody state** (`sealed` or `opened`, indicating whether the holder has extracted the Master from platform-mediated custody) and the **deed's lifecycle state** (`traded-in`, `rights-disputed`, `void`, `burned`, the exceptional conditions that override the image-custody axis). The image's seal is the cause; the deed's transferability is the effect. State is recorded as a mutable on-chain metadata field on the NFT, with state transitions triggered by buyer actions, creator actions, or platform actions in response to legal mandates.

| State | Meaning | Resale | Display Surfaces | Deed-holder download | Public render |
|---|---|---|---|---|---|
| sealed | Image in platform-mediated custody; deed active; holder has not downloaded the full-resolution Master | Allowed | Active | Available | Active |
| opened | Image extracted from custody; deed active; holder has downloaded the Master | Disabled | Active | Already exercised | Active |
| traded-in | Deed returned to issuing creator via §4.5 trade-in; held in creator account pending re-issuance | Disabled | Hidden from public; visible to creator only | Suspended | Suspended |
| rights-disputed | Takedown notice received; pending investigation | Halted | Suspended | Suspended | Suspended |
| void | Takedown confirmed; deed permanently invalidated; buyer refunded | Disabled | Suspended | Suspended | Suspended |
| burned | Catastrophic invalidation (CSAM detected post-mint, criminal seizure) | Disabled | Suspended | Suspended | Suspended |

**State Transitions.**

| Transition | Trigger | Effect |
|---|---|---|
| sealed -> opened | Deed holder requests Master download | Image extracted from platform-mediated custody; cached owner variants (Keepsake Copy, Share Copy) delivered to deed holder; resale capability disabled |
| sealed/opened -> traded-in | Deed holder selects this deed as trade-in at checkout of a paired same-creator new purchase (§4.5) | Deed transfers from holder to creator account; new deed mints to holder; holder pays (new price - trade-in discount); creator reserve debits discount value plus trade-in fee |
| traded-in -> sealed | Creator re-issues traded-in deed as a new edition after the 30-day cooling period | New edition number assigned; provenance disclosure of prior trade-in event recorded; new primary sale follows standard §4.5 mechanics |
| sealed/opened -> rights-disputed | DMCA / Take It Down Act / RoP / court-order takedown notice received | Display surfaces, downloads, and renders suspended; resale halted |
| rights-disputed -> sealed/opened | Counter-notice prevails OR investigation clears the deed | State restored to prior; capability returns to prior state |
| rights-disputed -> void | Investigation confirms takedown valid | Deed permanently invalidated; buyer refunded from creator reserve |
| sealed/opened -> burned | CSAM detected post-mint; criminal seizure | Immediate platform suspension; §2258A NCMEC report; law enforcement referral; deed permanently destroyed |

State transitions are recorded as on-chain mutations, providing an immutable audit trail that survives platform shutdown. Anyone reading the Solana ledger can verify the deed's current state by querying the on-chain `deed_state` field.

**On-Chain Mutation Primitives.**

The deed's `deed_state` field is mutable but writable only by an authorized platform multi-sig signer (during operation) or by the on-chain governance contract (after platform shutdown). The state-change transaction includes new state value, trigger reference (DMCA notice ID, court-order docket number, NCMEC report ID), timestamp, authorizing signer, and previous state for audit reconstruction.

Download and render suspensions on traded-in, rights-disputed, void, and burned states are enforced by the access-control renderer (§7.3 Layer 3) which checks the on-chain `deed_state` field before serving any rendering. The buyer's offline-decryption capability via Magic private key plus Solana wallet export (§3.4 license-survival) remains technically intact as an architectural matter -- the encryption keys cannot be recalled -- but contractual constraint applies via the BMA takedown-notice clause documented in §4.9.

#### 3.5.2 Multi-Recipient Smart Contract

Co-branded deeds and charity-flagged listings (referenced in §2.3) use a multi-recipient smart contract for primary-sale and resale-royalty distribution. The contract distributes proceeds at transaction time according to splits configured at mint:

| Recipient | Default | Configuration |
|---|---|---|
| Creator | 70-100% | Creator-set at mint |
| Co-branded second party (creator, brand, charity, peer creator) | 0-30% | Creator-set at mint per co-branding agreement |
| Charity (charity-flagged listings) | Variable | Reseller-set at list time per §2.3 |
| Platform fee | 10% | Governance-set; constant across transactions |

Resale-royalty distribution follows the same split structure, ensuring royalty mechanics are consistent through resale events. The smart contract is deterministic: distribution percentages cannot be modified after mint without a new on-chain transaction signed by all configured recipients.

For charity-flagged secondary sales (where the reseller routes proceeds to a charity rather than to their own account), the recipient address is selected from the platform's onboarded-charity registry at list time. Charity registry entries require independent verification (501(c)(3) status confirmation for U.S. charities, equivalent jurisdictional verification elsewhere) before they can receive on-chain transfers.

## 4. DIGITAL GALLERY PLATFORM

The Digital Gallery is a standalone website serving as the unified venue for Master Image discovery, authenticated display, primary sales, secondary resale, and revenue distribution. It delivers metered, authenticated viewing within a controlled environment rather than delivering a file. It serves three functions: passive viewing-fee revenue for Master owners, micro-fee access payments, and marketplace infrastructure for creator-to-buyer and owner-to-buyer transactions.

### 4.1 Revenue Model

Gallery display operates in two tiers. The **default gallery** requires zero owner effort: the platform sets a micro-fee ($0.001 per view), and the owner receives a small viewing fee share as an incidental benefit. Revenue at this tier is negligible and cannot reasonably constitute an expectation of profit. The **premium gallery** is an optional owner-activated tier where the owner sets their own viewing fee, controls show time and visibility, and promotes their collection independently. Owners can create premium galleries individually (a personal curated exhibition) or as a group (multiple owners pooling their Masters into a collaborative exhibition with shared revenue split). Group premium galleries enable co-curated shows, thematic exhibitions, or collector circles that collectively set access fees and promote the exhibition. The owner controls visibility through a Vault toggle (Section 4.7).

| Revenue Event | Creator | Platform | Owner |
|---|---|---|---|
| Master Sale (primary) | Sale price minus platform fee | Platform fee | Acquires Master + Exclusive License |
| Gallery Viewing | Share of viewing fees | Share of viewing fees | Share of viewing fees (gallery display revenue) |
| Master Resale (secondary) | Resale royalty (%) | Platform fee (%) | Sale proceeds minus royalties and fee |
| Trade-In + New Master Sale (bundled) | New sale price minus platform fee minus trade-in discount; receives traded-in deed back | Standard primary platform fee + trade-in fee from creator reserve | Acquires new Master + Exclusive License; surrenders traded-in deed (no cash differential) |

Master prices are set by the creator ($50+). Resale royalty percentages are set at mint and enforced by smart contract. At scale, micro-fees generate volume revenue: 1 million daily views = $1,000/day in viewing-fee throughput.

Gallery access operates on a micro-transaction model (~$0.001 per full-resolution view). Non-members browse thumbnails and metadata free (discovery funnel). Members pay per-view micro-fees for full-resolution access. Viewing fees split between the Master owner and the platform per a fixed ratio. All prices are set and displayed in USD; payment is processed through Stripe and accounted as an internal balance per account, with periodic payouts to the creator's connected Stripe account.

| Gallery Transaction | Fee Allocation |
|---|---|
| Primary Master sale | 90% to creator (with collaborator split routed via §3.5 multi-recipient contract when applicable), 10% platform fee |
| Secondary Master resale | Sale proceeds to seller, creator resale royalty (deed-encoded %), platform resale fee |
| Trade-In bundled with new primary sale | (New price minus trade-in discount) processed as primary sale (90% creator, 10% platform fee on gross new price). Trade-in discount routed as internal debit from the creator reserve account; trade-in fee (default 2% of discount) routed to platform |
| Gallery viewing fees ($0.001 / view) | Split between Master owner and platform per a fixed ratio; accounted as internal balance per account with periodic Stripe payout |
| Collaborator revenue share | Split percentage applies to whichever flow processes the payment event |

### 4.2 Discovery and Search

The gallery operates as a curated discovery platform across creator categories (gaming, tech, comedy, education, digital art). The platform is SEO optimized, ensuring gallery pages, creator profiles, and artifact listings are indexed and ranked by search engines to drive organic discovery. Users search by creator name, category, style, medium, date range, or tags, with filters for price range, ownership status, and verification tier. Discovery feeds include "New Arrivals," "Most Viewed," "Rising Creators," and "Curator Picks" (human-curated by DAO-elected curators).

**Creator Pages.** Each creator has a dedicated page displaying publicly visible Masters, verified identity, channel metrics, and aggregate sales statistics without identifying individual buyers or prices. Vaulted Masters are excluded (Section 4.7).

**Member Collections.** Any DAO member can create personal collections by pinning gallery artifacts, similar to Pinterest boards. Collections are public by default and appear in search results, making every member a potential curator. Members do not need to own a Master to add it to a collection, mapping directly to the prosumption dynamic (R67 §2.6): browsing (consumption) becomes curating (production) with no role transition.

**Image-Search Indexing.** Public image pages are instrumented for Google Images, Bing Images, and reverse-image-search surfaces (Google Lens, TinEye). Image-search ranking weights heavily on the image file and immediate page context rather than domain authority, making the channel accessible to a new platform without years of accumulated authority. Per-page implementation requirements:

| Element | Specification |
|---|---|
| Image filename | `[creator-slug]-[title-slug]-[year]-edition-[N].jpg` |
| Image alt text | Natural-language description: title, creator, edition, subject matter |
| Image URL path | `/deed/[creator]/[title]-[year]/[edition-N]` (semantic, not opaque IDs) |
| Image dimensions | 1500 to 2500 px on the long edge, JPEG quality high (Google penalizes heavily-degraded images) |
| Image format | JPEG canonical for indexing; WebP and AVIF served conditionally via the Picture element |
| Schema.org markup | `VisualArtwork` with `creator` (Person), `image` (ImageObject), `name`, `dateCreated`, `identifier`, `license` fields |
| HTML semantics | Title in H1, creator name in heading, descriptive paragraph from deed metadata, server-side rendered |
| OG and Twitter Card | Covered in Section 7.2 |
| Crawler accessibility | Server-side rendering of all metadata and surrounding copy; no JS-loaded primary content |

**Reverse-image-search.** Google Lens, TinEye, and similar tools maintain perceptual hashes of indexed images and match queries derived from screenshots, downloaded shares, and embeds. When a Gallery image propagates outside the platform, even with the link stripped or as a screenshot, reverse-image search resolves to the canonical image page on `gallery.creodom.com`, providing a discovery surface independent of caption hyperlinks. Combined with the URL-on-share mechanic (Section 5.2), this produces three independent discovery channels for any Gallery image encountered in the wild: caption hyperlink, embedded URL text, and perceptual-hash reverse lookup.

**Privacy interaction.** Deeds default to private at purchase per Section 4.7 -> image pages return `noindex` headers and the public-preview image is excluded from sitemaps until the owner invokes the Share affordance. The image-search index therefore covers only the public-shared subset of the catalog. The costly-signal mechanism documented in R67 §2.5 activates only on public display, providing the primary owner incentive to flip from default-private to public via Share.

**Indexing timeline.** Image-search indexing typically begins within days of a page being crawlable; meaningful image-search traffic to a new domain on competitive terms takes 6 to 12 months as an indexed library accumulates. Reverse-image-search hits begin appearing as soon as Gallery images enter shared contexts on the web, providing earlier traffic than text or image-keyword search. Domain-authority signals have less weight in image-search than in text-search, allowing a new platform to compete on image-search ranking before it can compete on text-search ranking.

### 4.3 Artifact Display and Metadata

The image page renders the artifact through the four-layer glass-box architecture (Section 4.4), alongside the deed's provenance and attribution metadata. The variant served depends on the viewer: the deed holder sees the Keepsake Copy (deed-holder download, private vault view); other visitors see the Share Copy post-sale (public render) or the Listing preview pre-sale. The Master is never publicly displayed; it remains encrypted on Arweave and is accessible only to the deed holder via the §7.5 download flow.

| Field | Source | Display |
|---|---|---|
| Creator Name | YouTube OAuth + KYC | Verified badge + display name |
| Creator Channel | YouTube OAuth | Channel name with subscriber count |
| Creator Headshot | Creator profile (captured at onboarding) | Headshot of the individual creator, shown beside or under the artifact; the persistent creator-presence anchor (R67 §5.16); non-face fallback only where an individual declines to show their face |
| Creator Description | Creator input at Card 3 (§3.2) | Required first-person artist statement rendered as the creator's words and bound visually to the headshot, so it reads as the creator explaining the work (R67 §5.16) |
| Context Video | Creator input at Card 3 (§3.2) | Optional; restrained link-out opening in a new tab; contextual enrichment, never the authenticity anchor (R67 §5.16) |
| Creation Date | Mint transaction timestamp | Date minted |
| Current Owner | On-chain NFT deed | Display name (or hidden if vaulted, Section 4.7) |
| Ownership History | On-chain transaction log | Transfer count + dates (hidden if vaulted) |
| Master Quality | Ingestion quality gate | Resolution, color depth, format |
| NFT Mint Address | Solana on-chain record | Truncated address with explorer link |
| Collection Tags | Creator + curator assigned | Category, style, medium tags |

Three viewing contexts: single artifact (full-screen with metadata panel), collection (grid of owner's holdings), and exhibition (curated sequence with narrative text).

The creator-presence block (headshot, required first-person description, and optional context-video link) renders adjacent to the artifact with the image kept dominant per R67 §5.8, presented in the gallery register rather than a social-promotion register so it reinforces the art-as-art state (R67 §2.3, §5.16) rather than a follower-count or trending surface. The headshot is a creator-account asset shown identically across all of that creator's image pages; the description and context link are per-image fields from §3.2.

**Image page composition.** Every image page renders in a standard layout; rationale in R67 §5.19. The layout enforces image dominance, immediate creator-presence visibility, and a single clear conversion path.

| Zone | Content | Notes |
|---|---|---|
| Hero (largest area, image-dominant) | Listing preview at 1080 px Instagram-optimized (§2.2) with the centered italic "Epimage" watermark (§2.2 watermark composition) | Image occupies the largest single area on the page; nothing in the framing chrome competes for visual weight |
| Adjacent block (right of image on desktop; below image on mobile) | Creator-presence block per §3.2 / earlier in §4.3: headshot, verified-creator badge, first-person description, optional context-video link | Gallery-register typography, not social-promotion register |
| Framing chrome (above and below image) | Title, creator name (text link to creator gallery), creation date, edition tier and number | Institutional caption in museum-label register; textual deed identification |
| Conversion bar | Listing price (plain numeric, no chart / floor / banner per §5.15); **"Own this"** CTA as the primary action button; **"View deed"** link as a secondary action grouped immediately adjacent to the CTA | Below the creator-presence block on desktop; fixed conversion bar on mobile. "View deed" routes to the deed-content page (§4.3 below). |
| Below the fold | Provenance summary, rights summary, optional redundant "View deed" link | The deed-content page carries the authoritative detail; this is convenience for buyers who scroll past the conversion bar |

**Canonical CTA wording.** The primary action button text is **"Own this"**. Variants ("Buy," "Purchase," "Acquire," "Invest") are not used. "Own this" carries the R67 §5.8 deed-as-receipt principle (the buyer owns the image; the deed makes that enforceable) and avoids the investment register R67 §6.6 disallows.

**Responsive behavior.** Desktop arranges the image and creator-presence block side-by-side with the conversion bar below; mobile stacks vertically (image, creator-presence, conversion bar, then below-fold detail). The visual-weight hierarchy (image largest, then creator-presence, then conversion bar) is preserved across breakpoints.

**Deed-content page.** The image page carries a "View deed" link to a dedicated deed-content page that surfaces the full deed instrument in human-readable form. Rationale in R67 §5.18.

- **Route:** `epimage.com/<image-id>/deed` (canonical); may also render as a modal on the image page.
- **Pre-purchase:** the page shows the deed as it will be issued, distinguishing firm fields (determined by Card 3) from TBD fields (set at Card 5 issuance).
- **Post-purchase:** the same page renders the actual on-chain deed and becomes the canonical public deed view.

Field-state schema:

| Section | Field | State pre-purchase | Source |
|---|---|---|---|
| Identity | Title, creator name, creation date | Firm | Creator input / profile, Card 3 |
| Identity | Edition tier and number | Firm | Creator decision, upload |
| Authentication | Content hash (sha256), perceptual hash | Firm | Card 2 ingestion |
| Authentication | Creator-signed ESIGN attestation and signing timestamp | Firm | Card 1 |
| Authentication | Arweave Master URI | **TBD** | Card 5 (on-Arweave Master built at issuance) |
| Technical | `image_spec` (§2.3) | Firm | Card 2 ingestion |
| Rights | License terms, royalty terms | Firm | Creator selection / platform default |
| Ownership | Owner wallet | **TBD** | Card 5 (buyer wallet) |
| Ownership | `sale_record` first entry: `amount_minor`, `currency` | Firm (listing price) | Card 3 |
| Ownership | `sale_record` first entry: `timestamp`, `tx_hash` | **TBD** | Card 5 (transaction at issuance) |
| On-chain | Deed on-chain address | **TBD** | Card 5 (deed mint) |
| Status | Issuance status | "Available -- deed not yet issued" pre-purchase; "Issued" post-purchase | -- |

**UI treatment of TBD fields.** TBD fields render in a recessive style (lighter weight, italic, or a small "to be issued" tag) so the buyer immediately reads them as the buyer's slot in the document: placeholders that purchase activates rather than missing data. This is the real-estate title-insurance commitment pattern (R67 §5.18). Firm fields render in normal weight.

**§5.15 display rule applies:** the deed-content page surfaces the price for the single deed as a bill-of-sale consideration entry, with no aggregation, cross-deed comparison, or appreciation analytic.

**Creator Page composition.** The Creator Page is the creator-account display surface; rationale in R67 §5.20. Composition centers the creator-as-curator, with the works grid as the discovery surface for the creator's cohort. No cross-creator works appear on this page.

| Zone | Content | Notes |
|---|---|---|
| Creator hero (top of page) | `creator_headshot` (large), creator display name, verified-creator badge, `creator_bio`, `creator_channel_url` as external link, "member since" date | All identity fields from §3.1 Creator-account display fields. No follower counts, view counts, or aggregated sale metrics per R67 §5.15 / §6.6. |
| Active works grid | Thumbnails (§2.2 Thumbnail variant; no watermark, no creator credit overlay) of currently available listings in a responsive grid (2-3 columns mobile, 3-4 columns desktop). Each tile: Thumbnail + work title + edition tier ("Unique" or "1/N") + listing price | Newest first by default. Click / tap routes to the work's image page. No sort by price, no "trending" sort: chronological only. |
| Sold works (below the fold) | Sold-out listings in the same grid format, with reduced opacity (suggest 40 to 60 percent) so they read as cohort depth rather than active inventory | Each tile shows Thumbnail + title + small "Sold" indicator. Clicking still routes to the image page (which renders the deed as Sold). No total-sold count, no aggregate price, no resale history at the creator level. |

**No CTA on this page.** The "Own this" CTA lives on individual image pages (§4.3 above); the Creator Page surfaces routes to those pages but does not carry a purchase action itself.

**Typography.** EB Garamond Italic is reserved for gallery-register surfaces (notably the Listing-preview watermark per §2.2 and the Gallery brand wordmark); it is not used for general UI copy on the Creator Page. The Creator Page UI follows the product's overall typography system, which is a separate decision from this composition spec.

**Responsive behavior.** Desktop and mobile both stack the same vertical hierarchy: creator hero block at top, active works grid below, sold works below the fold. Desktop expands the grid laterally (more tiles per row) rather than rearranging the priority.

### 4.4 Four-Layer Glass-Box Display Architecture

Every public rendering is a controlled reduction of the original through four compounding layers. The authenticated owner retains exclusive full-resolution access.

**Layer 1: Structural Glass (Platform Quality Minimums).** Artwork meeting platform minimums (4000px+ on longest edge) exceeds native display capacity of any standard screen (4K = 3840x2160). Every public rendering is inherently a screen-fitted reduction. The owner can zoom to 100% native resolution through their authenticated session.

**Layer 2: Intentional Glass (Owner Display Controls).** Per-NFT settings: watermark (customizable placement, opacity, design), compression level, resolution cap, and display dimensions. The gallery sets a minimum quality floor; the owner adds restriction above it.

**Layer 3: Categorical Glass (Institutional Presentation).** Every artwork renders inside an institutional frame: verified creator attribution, owner identity badge, provenance timeline, and digital autograph seal. This framing is not dismissible and activates the self-transcendence effect (R67 §2.5) -> art experienced as art rather than as a file.

**Layer 4: Deliberate Glass (Platform Artwork Standards).** Standards far above typical internet specifications (minimum 4000x4000 vs. typical 1080x1080 social media) place gallery artwork in a categorically different class from ordinary digital images.

**Owner's Private View.** The authenticated session bypasses intentional and categorical glass. Full resolution, no watermark, no compression, no overlay. Structural glass remains (finite screen pixels) but the owner can zoom and pan at 100%.

**Anti-Save Measures.** Disabled right-click/long-press, disabled drag-and-drop, canvas/WebGL rendering, tiled segment compositing, blocked screenshot extensions, transparent interactive overlays, and OS-level screenshot restriction on supported mobile platforms.

### 4.5 Resale and Trade-In Workflows

The resale fee plus creator royalty distribute via smart contract per §3.1 Post-Journey and §3.5 state machine. A 30-day settlement period applies after every transfer -- the new owner has full access but cannot relist during this window. Resale uses a creator-set fixed price, consistent with the primary-sale pricing format in §2.2; the auction alternative described there applies equally to resale.

*Resale Workflow (Card 8 RELIST).* The seller's resale-listing surface mirrors the structure of the creator's primary-listing surface, with three distinct ESIGN-relevant actions captured per listing:

| Step | Action | System | Notes |
|---|---|---|---|
| 1 | Seller initiates Relist from the image page in their Collection | Web App | Selects the deed to relist; deed must be in `opened` or `sealed` state past the 30-day settlement period |
| 2 | Stripe Connect bank link + KYC | Stripe | First-resale-listing KYC trigger per §4.10.3; subsequent listings reuse the connected account |
| 3 | Seller sets fixed price or auction reserve | Web App | Auction format follows the eBay hybrid (reserve + optional Buy Now) |
| 4 | **Seller Resale Listing Authorization (ESIGN)** | Web App + Backend + Solana | Combined click-wrap ESIGN + on-chain wallet signature authorizing the platform's smart contract to transfer this deed at the seller-set price; full specification in §3.4 |
| 5 | Listing live | Backend + Solana | Deed surfaces in resale discovery and on the image page with a Buy entry point |
| 6 | Share purchase link | Web App | Seller shares the image page link to drive buyers; same share-mediated distribution mechanics as primary sale (R66) |
| 7 | Buyer purchases (BACK TO Card 4 of a new cycle) | Stripe + Crossmint + Backend | The new buyer enters Card 4 PURCHASE and signs a fresh per-image Buyer License Acceptance for THIS deed (the license terms travel from mint via UCC Article 12 tethering per R67 §6.2); Card 5 DEED transfers the deed to the new buyer via the Metaplex Core transfer plugin. The on-chain nested encryption is re-built: platform decrypts `DEK_image` from the server-side operational copy via `platform_DEK`, constructs the new inner ciphertext `encrypt(DEK_image, new_buyer_wallet_pubkey)`, re-applies the outer `encrypt(inner, platform_DEK)` layer, and writes the new `enc_final` to deed metadata via Metaplex Core UpdateDelegate (prior nested encryption invalidated; the Arweave URI, the Arweave bytes, and the server-side operational copy are all unchanged); distributes payment (price minus platform resale fee minus creator royalty to seller; creator royalty to creator; platform resale fee to platform), and issues the COA email package per §3.4 to both the new buyer and the seller (with a license migration receipt referencing the new buyer's BMA, per-image License Acceptance, and the original creator's CMA). Card 6 personalization for the new buyer generates fresh Keepsake Copy and Share Copy variants built from the Original (§2.2 Master Image storage) |

*Listing-active state freeze.* While a deed is in active listing (post step 4, pre step 7), the seller's download surfaces and new-share-link generation are frozen:

| Surface | Freeze during active listing | Reason |
|---|---|---|
| Master download | YES | Mandatory; Master download transitions the image from sealed to opened (recorded as `deed_state` per §3.5.1), which permanently disables resale. Allowing Master download during an active listing would self-cancel the seller's listing |
| Keepsake Copy download | YES | Self-dealing prevention; the seller has committed to transfer via the Resale Listing Authorization and cannot extract fresh personal copies during the listing period |
| Share Copy download | YES | Self-dealing prevention; the Share Copy is also the share-marketing artifact and its fresh generation during listing would multiply outbound surfaces under seller control |
| New share-link generation (Card 6 DISPLAY) | YES | The seller cannot mint new shareable URLs or URL-text-bearing Share Copies during the listing period |
| Existing share links and Share Copies in circulation | NO -> remain functional | Previously-shared Share Copies and embedded URLs resolve to the image page; the image page re-renders in "for sale" mode during active listing, converting every prior share-mediated surface into a resale-listing marketing funnel |
| Card 8 "Share purchase link" (the new listing URL) | NO -> active | The listing-share URL is the seller's marketing channel for the resale event |

Freeze releases on listing withdrawal (downloads and new-share-link generation resume for the seller; image page reverts to standard owned-by rendering) or on sale completion (downloads and new-share-link generation become available to the new buyer per Card 5 / Card 6 of the new cycle). The state-machine modifier is `sealed+listed` -> `sealed` on withdrawal, `sealed+listed` -> transfer on sale completion.

**Trade-In to Platform Credit.** Trade-in is a creator-offered swap mechanism: when a deed holder buys another deed from the same creator's catalog, they may return a previously held deed at checkout in exchange for a trade-in discount applied to the new purchase. Trade-in is bundled with a paired new purchase, not a standalone exit. The mechanism is opt-in per drop (creator activates at mint on the originating drop), funded from a creator-held reserve, and usage-priced from the returned deed's Master-download events and per-buyer share log (§5.2, §7.3, §7.5). The mechanism gives deed holders a creator-controlled trade-up path and gives creators a tool for catalog refresh and audience retention.

*Eligibility.* Trade-in is offered at the new-purchase checkout when (a) the deed being returned was issued on a drop where the creator activated trade-in at mint, (b) the returned deed is in `sealed` or `opened` state (`rights-disputed`, `void`, `burned`, and previously `traded-in` deeds are ineligible), and (c) the deed holder is concurrently purchasing a new deed from the same creator's catalog. Trade-in cannot be redeemed against another creator's catalog, against viewing fees, or as a standalone exit without a paired new purchase.

*Pricing formula.* Per-drop parameters set by the creator at mint of the originating drop:

| Parameter | Default | Range |
|---|---|---|
| Base credit | 50% of original sale price | 10-90% |
| Master-download decrement (per event) | 5% of base | 0-20% |
| Share decrement (per per-buyer share event) | 1% of base | 0-5% |
| Time decay | Disabled | 0-25% per year |
| Credit floor | 10% of original sale price | 0-50% |

The trade-in discount at checkout equals base credit minus accumulated Master-download, share, and time-decay decrements, bounded below by the floor. Below floor, trade-in is not offered for that deed at this checkout. The discount is capped by the new purchase price -- trade-in cannot exceed the price of the new deed and creates no cash differential payable to the holder. The deed holder sees the discount with its decrement breakdown so the pricing is transparent.

*Funding and gating.* Each creator maintains a trade-in reserve account funded from accumulated revenue or direct deposit. Trade-in is offered at checkout only when reserve balance covers the discount value plus the platform trade-in fee. Insufficient reserve hides the trade-in option without disabling the deed holder's other liquidity paths; peer resale via peer resale remains available independently.

*Transaction flow.* The deed holder browses the creator's catalog, selects a new deed, and proceeds to checkout. The platform queries (a) eligible deeds in the holder's vault from the same creator's trade-in-activated drops, (b) usage logs for each eligible deed, (c) creator reserve balance. The platform displays each eligible deed with its current trade-in discount; the holder optionally selects one deed to trade in. Smart contract executes atomically on payment confirmation: the new deed mints to the holder, the traded-in deed transfers to the creator account with state mutated to `traded-in` (§3.5.1), the holder pays (new price minus trade-in discount) via standard fiat rail, the creator reserve debits the trade-in discount value, and the platform takes the trade-in fee from the creator reserve (governance-set, default 2% of discount value). Subsequent re-issuance of the traded-in deed by the creator is treated as a new primary sale at a new edition number with provenance disclosure of the prior trade-in event, after a 30-day cooling period mirroring the secondary-sale settlement window.

### 4.6 Gallery Portals

| Portal | Primary Use | Authentication | Target Behavior |
|---|---|---|---|
| Mobile App | Daily engagement, personal collection viewing | Digital passport | Patron persona: living with art |
| Web App | Extended browsing, collection management, transactions | Digital passport or public access | All personas: discovery, curation, buying, selling |
| Social Embeds | External sharing, gallery marketing | None (public rendering with glass-box protection) | Discovery funnel: drives traffic to gallery |
| Webpage Widget | Embeddable gallery on creator websites | None (public rendering with glass-box protection) | Creator-driven acquisition: fans discover Masters on creator's own site |

The mobile app is the primary daily-engagement surface; the behavioral rationale (the living-with-art basis of digital ownership, the Patron persona) is documented in R67. Social embeds preserve all glass-box protections while functioning as gallery marketing on external platforms.

### 4.7 Privacy Architecture

The Web2 abstraction layer (Doc R35) creates architectural privacy separation: Solana stores only machine-level data (wallet hex strings, mint addresses, transfer transactions), Arweave stores only encrypted files, and all human-readable information (names, prices, metadata, provenance) exists exclusively in the platform database. No external observer can connect on-chain data to real people or artwork without the platform's mapping layer. This makes the Vault default a genuine total privacy control.

**Privacy default at purchase.** When a buyer completes purchase at Card 5, the image enters Vault mode by default -> `images.visibility = 'private'` is set on deed issuance. Nothing about the Master Image is surfaced publicly; only the owner has authenticated access.

This default-private posture is grounded in two rationale axes:

- **R67 psychological ownership.** R67 §5.5 explicitly designs against the "permanent public-by-default" pattern that failed in the NFT cohort and prescribes a toggle that defers the visibility commitment to the owner. Default-private serves all three buyer psychologies in R67 §2 -> the connoisseur (PKD-2 intimate-knowledge route) is supported natively without forcing the owner into the socializer role at acquisition; the status-seeking socializer takes the explicit Share action, which IS the Spence costly-signal opt-in (R67 §2.5) -- universal default-public would dilute the cost-calibration property by surfacing signaling without the owner choosing to signal; the contextual-identity holder can flip to public when context activates the Seller / socializer identity. Schlager-Ostrom Exclusion (R67 §4) defaults to maximally exclusive and is relaxed only by explicit owner action, supporting the PKD-1 Control route at the acquisition moment.
- **Howey defense (R12 / R67 §6.6).** Zero public visibility, zero price signal, and zero speculative surface at acquisition -> consistent with the personal-consumption framing the securities-classification posture rests on. Consumer expectation that purchases are private until the buyer chooses to share is consistent with both axes.

**Privacy flip via Share.** The owner can elect to publish by activating the Share affordance on the image page. This is a one-way flip for the current owner's tenure -> `images.visibility = 'public'`, the public image-page becomes indexable, the Share Copy variant becomes available through public render, and the public-page CDN cache is purged of any prior state. The first Share click opens a confirmation modal warning the flip is irreversible for the current owner; on confirm, the backend executes the visibility flip and surfaces the shareable link. Subsequent Share clicks copy the link directly.

**Vault mode behavior.** While `images.visibility = 'private'`, nothing about the Master Image is publicly surfaced:

| Data Layer | Private (default after purchase) | Public (after Share, current owner's tenure) |
|---|---|---|
| Artwork rendering | Not rendered publicly; owner-only via authenticated view | Visible through glass-box (Section 4.4) |
| Owner identity | Not surfaced | Display name or anonymous badge |
| Sale price | Not displayed (fiat via Stripe) | Not displayed |
| Provenance | Not surfaced | Transfer count and dates |
| Search / discovery | Excluded from all results | Indexed in search, feeds, collections |
| Creator page | Not listed | Listed |
| Image page indexing | `noindex` headers; excluded from sitemaps | Indexable |

**Resale reset.** On deed transfer, the visibility flag resets to `'private'` -> the incoming owner inherits a Vault-mode deed by default, regardless of the prior owner's Share choice. Each owner makes their own Share decision; the prior owner's tenure-bound public state does not bind the new owner.

The owner retains full authenticated access regardless of public/private state (Section 4.6). Creator pages show aggregate metrics (total minted, total sold) without identifying buyers, prices, or vaulted works. Sale prices processed through Stripe Connect bypass the blockchain entirely, eliminating price history displays that fueled NFT speculation. Total privacy for default-vaulted Masters strengthens Howey defense: zero gallery revenue, zero visibility, zero price signal -> on-chain evidence of pure personal consumption.

### 4.8 Gifting

Birthday shout-outs, graduation messages, congratulations, and holiday presents are natural use cases for creator-authenticated digital assets. Gifting drives acquisition: the recipient and their social circle discover the platform through the shared experience.

**Gifting Flow.** The buyer purchases a Master Image (primary sale) or selects a "Gift This" option during checkout. The buyer enters the recipient's email address and an optional personalized message. The platform sends a redemption email containing a unique claim link with a time-limited token. The recipient clicks the link, creates an account (or logs into an existing account), and accepts the gift. On acceptance, the smart contract transfers the NFT deed to the recipient's wallet, activates the Exclusive License in the recipient's name, and generates a Gift Receipt referencing the BMA version hash. The entire process requires no blockchain knowledge, no wallet setup (the Web2 abstraction layer in Doc R35 handles embedded wallet creation at account signup), and no action beyond clicking a link and creating an account.

**Unclaimed Gift Handling.** If the recipient does not claim the gift within 30 days, the platform notifies the buyer with three options: (1) extend the claim window by 30 days, (2) redirect the gift to a different email address, or (3) cancel and receive a full refund. The NFT deed remains in escrow (platform custody) during the claim window and is never minted to the recipient until acceptance. This prevents unclaimed gifts from creating orphaned on-chain assets.

**Gift Presentation.** The redemption email renders a preview of the Master Image (thumbnail resolution with glass-box protection) alongside the buyer's personalized message, the creator's name and verified badge, and a prominent "Claim Your Gift" button. The landing page displays the full glass-box gallery view of the artwork with provenance metadata, reinforcing the ownership value proposition before the recipient creates an account. This first-touch experience is the primary acquisition funnel for new users who did not discover the platform through creator marketing.

**Gifting as Durable Asset.** Unlike consumable digital gifts (e-cards, personalized videos), a gifted digital autograph is a full deed: the recipient owns it, can display it publicly, add it to curated collections, and resell it on the secondary market. The recipient becomes a platform member with an immediate starter collection, lowering the activation barrier for subsequent self-purchases.

**Revenue Classification.** Gifted Master Image sales follow the same fee allocation as standard primary sales (§4.1): 90% to creator (with collaborator split where applicable), 10% platform fee. The gift wrapper is a distribution mechanism, not a separate product.

---

### 4.9 Takedown Compliance Procedures

The platform receives takedown demands under multiple legal regimes, each with distinct procedural requirements. This section specifies the per-regime dispatch, buyer-refund mechanics, creator-account state mutations, and the platform-buyer compliance asymmetry.

#### 4.9.1 Per-Regime Dispatch

| Regime | Source | Statutory clock | Counter-notice | Platform action |
|---|---|---|---|---|
| DMCA §512(c) | Copyright takedown notice | "Expeditious" (case-law: 24-48 hours) | Yes (10-14 business days) | sealed -> rights-disputed; counter-notice -> restore; no counter-notice or court order finds infringement -> void with refund |
| Take It Down Act | Federal NCII takedown notice | 48 hours | None (statute does not provide one) | sealed -> rights-disputed; verified NCII -> void within 48 hours; refund |
| State NCII statutes (CA Civil Code §1708.86, NY §52-b) | State-court order or compliance demand | Per state statute | Per state | Same as Take It Down Act |
| Right of Publicity | State-court injunction | Per court order | Per court order | rights-disputed; injunction stands -> void; refund |
| CSAM identified post-mint | NCMEC hash-index update or law enforcement notice | Immediate | None | Immediate burned; §2258A report; law enforcement referral; refund |
| Court order (general) | Equity court (defamation, trademark, harassment) | Per order | Per order | Per order |
| Foreign jurisdiction (DSA Art. 16, GDPR right-to-erasure, UK Online Safety Act) | Foreign-jurisdiction order | Per regime | Per regime | Per regime, with jurisdictional anchoring per R65 §3.8 |
| Subpoena | Court-issued subpoena | Per order | n/a (information demand) | Information production via §3.4 three-point evidentiary chain; deed state unchanged unless court order separately requires |

#### 4.9.2 Buyer-Refund Mechanics

When a deed transitions to void or burned, the buyer is refunded from the creator reserve held in escrow (graduated-penalty pattern documented in §6.7).

1. Buyer notified of the takedown, the regime invoked, and the basis
2. Refund issued from creator reserve to the buyer's purchase payment method (Stripe Connect reversal for fiat; on-chain transfer for crypto-rail purchases)
3. Refund amount equals the most recent purchase price for the deed (primary sale or resale, whichever is most recent)
4. Resale chain is unwound at the most recent transfer point only -- earlier transfer participants do not face retroactive refunds
5. Refund completion is recorded on-chain alongside the void or burned state transition

No refund issues while the deed is in `rights-disputed` state. The deed is suspended but not yet void; a counter-notice or court order may restore it. Refund processes only when the state resolves to `void` (refund issues per the steps above) or back to `sealed` / `opened` (deed restored, no refund). The buyer is notified of the rights-disputed transition and the expected resolution timeline.

#### 4.9.3 Creator-Account State Mutations

Takedown-driven deed invalidations mutate the creator's account state per the §6.7 graduated-penalty pattern:

| Severity | Account action |
|---|---|
| First DMCA / RoP violation | Warning; temporary minting suspension |
| Repeated DMCA / RoP violations | Permanent minting suspension |
| Pattern of false rights claims | Permanent platform removal; royalty forfeiture |
| Verified CSAM | Immediate permanent platform removal; royalty forfeiture; §2258A NCMEC report; law enforcement referral |
| Verified NCII (real or synthetic) | Immediate permanent platform removal; royalty forfeiture; Take It Down Act compliance |

#### 4.9.4 Platform-Buyer Compliance Asymmetry

The platform achieves takedown compliance for its own footprint by suspending display surfaces (image page, OG card, discovery, marketplace listing) and decryption / render pathways (§7.5). The buyer's offline-decryption capability is preserved as an architectural matter (§3.4 license-survival language) because that capability protects against platform-shutdown risk for legitimate buyers.

This creates an asymmetry: platform compliance is fully effective from the platform's perspective, but a buyer who continues to use the Master after notification creates separate exposure under the underlying legal regime -- copyright infringement, right-of-publicity, NCII statutes -- independently of Gallery's compliance.

The BMA includes a takedown-notice clause specifying that buyer's continued use after platform notification of a takedown is the buyer's own responsibility under the underlying regime. The platform's documented notification (BMA-bound) is admissible evidence in subsequent proceedings against the buyer if the buyer continues use after notification.

#### 4.9.5 Adversarial-Takedown Protection

The DMCA counter-notice mechanism protects against frivolous or harassing takedowns. The 10-14 business day window allows the creator to assert good-faith reproduction rights. False takedowns under DMCA §512(f) carry knowingly-misrepresenting damages and attorney's fees. R65 §3.9 documents the broader DMCA-counter-notice-abuse threat surface and platform countermeasures; R65 §3.11 documents the adversarial-takedown-abuse threat surface and platform countermeasures.

#### 4.9.6 Subpoena Response

The platform's three-point evidentiary chain (CMA / BMA version hash plus NFT mint address plus transaction hash, per §3.4) is structured for subpoena response. Information production includes deed metadata, ownership history, creator identity records, model releases (§6.5), license documents (§6.7), and origin-declaration records (§6.4). Evidentiary admissibility is supported by Vermont 12 V.S.A. §1913 blockchain-record presumption and equivalent state statutes.

### 4.10 Account Lifecycle and Profile-Deed Association

This section specifies the platform's account-side handling of ownership transfers, complementing the wallet-side architecture documented in §3.4 (license survival), §3.5 (deed mechanics), §4.9 (takedown procedures), and R67 §5.13 (RUFADAA compliance posture).

The account-side architecture is largely conventional SaaS account-lifecycle implementation: profile-deed DB sync at on-chain transfer (per §7.4), executor-disclosure pipeline under RUFADAA §16, deceased-account freeze plus profile archival plus tax-record retention (7-year IRS minimum), feature-conditional KYC at resale and Stripe Connect setup, heir account creation on the heir's own wallet with the heir's own KYC. This section documents only the architectural elements that are non-conventional -- those that interact with or are constrained by the wallet-anchored ownership architecture.

#### 4.10.1 Wallet-Based Identity Model

Ownership is wallet-anchored on Solana. The platform's profile database (§4.7 Privacy Architecture) maintains a wallet-to-profile mapping where each wallet is the canonical ownership identifier and the profile is the human-readable presentation layer. The wallet IS the canonical owner; the profile is associated with the wallet, not the other way around.

The architectural separation between wallet (ownership) and profile (presentation) is load-bearing. A platform that conflates the two -- gating deed access on profile completion, conditioning on-chain transfers on platform-account state -- compromises the §3.4 license-survival property. The platform's account-side mechanics preserve the separation throughout the account lifecycle.

#### 4.10.2 Heir Login Path Discouragement (Path A)

The wallet-anchored architecture creates a non-conventional inheritance edge case: an heir who recovers the deceased's Magic wallet (e.g., via email recovery if the executor has email-account fiduciary access) can technically log in to the platform under the deceased's wallet without executing an on-chain transfer.

This path -- "Path A" in the inheritance flow -- is contractually discouraged via the BMA's account-lifecycle clause. Operating under the deceased's identity creates impersonation risk for KYC, tax reporting (1099 issuance to the deceased's TIN is incorrect), and AML compliance. The platform's UI surfaces an account-status check at first login after verified death notification, requiring the user to confirm they are the deceased's heir and prompting them to follow Path B (on-chain transfer to heir's own wallet, with heir creating their own platform profile).

The architectural distinction matters because Path A is uniquely a wallet-anchored-ownership artifact -- conventional SaaS platforms do not have this surface, because authentication is platform-side rather than wallet-side. The platform's countermeasure is contractual (BMA clause) plus operational (UI status check), not cryptographic, because cryptographic enforcement would require the platform to gate wallet capabilities, which would compromise §3.4 license-survival.

#### 4.10.3 Account-Side Compliance with Wallet-Side Architecture

The account-side architecture preserves the wallet-side architecture's structural properties:

1. **The platform never gates downloads or renders on profile creation status.** Cryptographic access via the wallet is sufficient. Profile is a UI-layer presentation; deed access is a wallet-layer entitlement.
2. **The platform never holds the buyer's private keys via the profile system.** Profile data lives in the platform database; private keys live in Magic's wallet infrastructure.
3. **The platform does not condition deed transfer on profile compliance.** The new owner can receive the deed via on-chain transfer regardless of whether they have a platform profile. Profile setup is a downstream prompt, not an upstream gate.
4. **The platform's account-freeze on verified death does not affect the wallet's on-chain capabilities.** The freeze is a profile-layer mechanism; the deceased's wallet retains full Solana-network capability that survives platform shutdown per §3.4.
5. **KYC re-verification is feature-conditional, not ownership-conditional.** Passive use (vault display, deed-holder download) requires no platform-side KYC; KYC is triggered at the point of resale, royalty payout, or high-value transactions where the platform has regulatory reporting obligations. The heir who only intends to display the deed in their vault and never resell does not need to complete platform-side KYC at inheritance.

The cumulative effect is a thin presentation-and-compliance layer over the wallet-anchored ownership architecture. Account-side actions (login, profile editing, vault toggling, marketplace listing) are platform-mediated; ownership-side actions (deed transfer, decryption, license survival) are wallet-mediated. The two layers do not share authority.

---

## 5. REPRODUCTION AND DISTRIBUTION

This section documents the commercial-reproduction extension that creators may activate to allow Master Owners to generate additional Share Copies for resale through external channels. Every deed at mint produces the canonical pair of personal artifacts -> the **Keepsake Copy** (URL text optional, for personal display) and the **Share Copy** (with visible URL text, for social-media sharing) -> independent of reproduction-rights status (§2.2 variant table). This section covers what is additionally enabled when the creator opts in to commercial reproduction: the Master Owner can generate ADDITIONAL Share Copies through the platform's degradation engine and sell them through any external retail channel. The core platform (minting, custody, gallery, resale) operates independently of this extension. Reproduction rights are not included in the default per-image License Acceptance; they require separate creator authorization at mint time.

### 5.1 Reproduction License Activation

The creator may enable reproduction rights as an independent action at any time, separate from mint, sale, or resale events. Reproduction license activation is a standalone creator decision managed through the creator's dashboard. When enabled, the Master Owner acquires the right to generate ADDITIONAL Share Copies (beyond the canonical Keepsake Copy / Share Copy pair generated at deed mint) through the platform's degradation engine, and sell those additional Share Copies through any external retail channel of their choosing (Shopify, Gumroad, Etsy, personal website). The creator may also revoke or modify reproduction rights at any time; changes apply to future Share Copy-generation requests but do not affect Share Copies already produced. Reproduction rights state is stored on-chain as a mutable metadata field in the NFT and mirrored in the platform database (Section 7.4).

**Creator-Defined Reproduction Parameters:**

| Parameter | Options | Enforcement |
|---|---|---|
| Permitted forms | Digital only, physical only, or both | Reproduction engine blocks unauthorized formats |
| Quantity cap | Unlimited or fixed maximum (e.g., 500 replicas) | Engine stops generating replicas at cap |
| Minimum quality floor | Creator sets lowest acceptable resolution tier | Engine rejects replica requests below floor |

### 5.2 Keepsake Copy / Share Copy Licensing and the Degradation Engine

The Keepsake Copy and Share Copy variants generated at Card 6 personalization (composition specified in §2.2; URL-text placement and costly-signal rationale in R67 §5.9 and Appendix I) carry distinct licensing semantics.

**Keepsake Copy (creator-opt-in).** When the creator has enabled the Keepsake Copy variant at upload, the deed bundles a Keepsake Copy alongside the Share Copy. Licensed strictly for non-commercial personal use -> small physical applications (mug, badge, small framed print), high-quality phone wallpaper, vault view. Redistribution, printing for sale, or any commercial use of the Keepsake Copy is prohibited under the per-image License Acceptance (§3.4) unless the creator has additionally enabled reproduction rights (§5.1). The Keepsake Copy license is held by the deed holder only while they hold the deed; on resale it travels with the deed to the new owner, so a Keepsake Copy file the seller downloaded before the sale is no longer licensed once the deed transfers. The per-image License Acceptance discloses this post-sale position to the buyer at purchase.

**Share Copy.** Licensed for social-media sharing, image-page display, and share-mediated distribution. The visible URL text resolves to the Gallery image page, allowing any viewer to verify provenance, creator, current owner attribution (per R67 §5.5 toggle state), and authentication chain via iOS Live Text or Google Lens.

**Commercial Reproduction (creator opt-in).** When the creator has enabled reproduction rights (§5.1), the deed holder may generate ADDITIONAL Share Copies through the platform's degradation engine for commercial resale through external channels. Commercial Share Copies follow the same URL-text-bearing composition as the canonical Share Copy generated at Card 6 personalization, with two additional constraints enforced by the engine: a hard resolution ceiling capped at a fixed percentage below the Original's native resolution (e.g., 80% of Original resolution on longest edge), and the wholesale royalty plus platform fee charged at generation (§5.3). The Original is never exposed in its source form; the engine retrieves the Original from server-side custody (encrypted at rest), decrypts it in a secure rendering environment, generates the Share Copy at the owner's specified parameters within the ceiling, embeds provenance metadata and URL text, and delivers the file for download. The Original is unchanged; the on-Arweave Master is not involved in commercial reproduction.

**Owner-Controlled Reproduction Settings (when creator-enabled):**

| Parameter | Owner Controls | Platform Enforces |
|---|---|---|
| Resolution | Any value up to ceiling | Cannot exceed ceiling (% of Master) |
| Format | JPEG, PNG, WebP | Available format list |
| Compression | Any quality level | Minimum compression floor |
| Price | Any amount | Minimum price floor (if applicable) |

The canonical Keepsake Copy / Share Copy pair generated at Card 6 personalization is not subject to the reproduction-rights gate; it is produced for every deed regardless of reproduction-rights status. Only ADDITIONAL Share Copies beyond the canonical pair require reproduction rights. The Master Image itself is never sold or distributed; the deed's transferable right is to the Master Image + Keepsake Copy + Share Copy bundle, with commercial reproduction as the creator-toggled extension.

### 5.3 Wholesale Revenue Model

The creator's royalty for commercial reproduction is collected at the point of additional-Share Copy generation, not at point of sale. When the owner generates an additional Share Copy beyond the canonical Keepsake Copy / Share Copy pair from Card 6 personalization, the platform charges a generation fee that includes the creator's copyright royalty and the platform's processing fee. This is a wholesale model: the owner pays upfront per additional Share Copy, then sells at whatever retail price the market bears through any external channel. The platform has no involvement in downstream retail transactions. The Keepsake Copy and the canonical Share Copy generated at Card 6 personalization are not subject to this fee; they are produced as part of the standard personalization composition.

| Fee Component | Share | Collected At |
|---|---|---|
| Creator Copyright Royalty | Set by creator at mint | Additional-Share Copy generation (download) |
| Platform Processing Fee | Set by governance | Additional-Share Copy generation (download) |

### 5.4 Optional Platform Storefront

The platform optionally provides Master owners with a turnkey retail interface for selling replicas directly through the platform. The storefront extension handles product listing, payment processing (Stripe Connect), and automated revenue splitting.

**Revenue Distribution (Storefront Model):**

| Recipient | Share | Mechanism |
|---|---|---|
| Creator (IP Royalty) | 10% | Automatic via Stripe Connect split |
| Creator (Affiliate Commission) | Variable (5-30%) | Set by Merchandiser, paid when creator routes traffic |
| Platform Fee | 5% | Standard platform commission |
| Merchandiser (Net Profit) | Remainder (55-80%) | Deposited to Merchandiser's Stripe account |

**Reverse Affiliate Bidding.** When a creator's page includes a "Buy Prints" link, the platform dynamically routes that link to the Merchandiser currently offering the highest affiliate commission. Merchandisers compete for creator traffic by adjusting the commission percentage.

**Embeddable Storefront Widget.** The protocol provides creators with an embeddable widget for any external website, enabling the Merchandiser's storefront to render within the creator's own web property.

---

## 6. QUALITY GATE

The platform sets minimum quality thresholds for Master Image acceptance. The quality bar is calibrated to what a premium smartphone camera or consumer-grade scanner can achieve, reflecting the actual production tools of the target creator base: YouTubers, digital artists, illustrators, and content creators.

| Parameter | Minimum Threshold | Reference Device |
|---|---|---|
| Resolution | 4000px on longest edge | iPhone 16 Pro Max (8064x6048 native) |
| Color Depth | 8-bit per channel | Standard consumer device output |
| Color Space | sRGB | Universal consumer standard |
| Format | JPEG (Q90+), PNG, or TIFF | Standard digital export formats |
| Metadata | Creator identity, creation date | Platform-embedded at ingestion |

### 6.1 Web Upload Surface and Local Quality Checks

Creators upload through the Gallery web app, which is the primary and only required upload surface. Quality checks run client-side in the browser using JavaScript, Canvas, and WebAssembly modules; no browser extension or native app is required. The web upload surface covers Chrome, Edge, Firefox, Safari, and mobile browsers, providing universal creator coverage including Mac and iPad professionals and in-app browsers.

**Single File Upload.** The creator selects a file via drag-and-drop or the standard file picker. The web app performs local quality checks (resolution, color depth, format, file size) in the browser before any upload begins. Files that fail receive immediate feedback identifying the parameter that fell short. Files that pass are uploaded to the platform for server-side ingestion-gate processing (§6.2 through §6.9) and Arweave encryption.

**Batch / Folder Upload.** The creator selects multiple files via multi-select drag-and-drop or the directory picker (HTMLInputElement `webkitdirectory`). The web app scans all files in the selection, flags any that fail quality thresholds, and runs a lightweight client-side near-duplicate pre-check across the selection to catch obvious duplicates within the session before upload. Qualifying files queue and upload in sequence with progress reporting.

**Local Quality Checks.** The web app validates the following parameters in the browser before upload, providing instant pass/fail feedback per file:

| Check | Validation | Browser Mechanism |
|---|---|---|
| Resolution | Minimum 4000px on longest edge | Canvas decode + `naturalWidth`/`naturalHeight` |
| Color depth | Minimum 8-bit per channel | File header parse (JPEG SOF, PNG IHDR, TIFF BitsPerSample) |
| Format | JPEG (Q90+), PNG, or TIFF | File magic-byte inspection plus extension check |
| File size | Minimum floor (prevents upscaled low-quality sources) | `File.size` against floor table by resolution tier |
| Batch uniqueness | Local near-duplicate pre-check across selected files | WASM image-hash module runs per file in a Web Worker; obvious in-session duplicates flagged before upload |

Local checks eliminate wasted bandwidth on files that would fail server-side validation and provide faster iteration for the creator.

**No filesystem cleanup is required of the platform.** The deed-bound master is identified by its on-chain content-hash anchor (§2.1): the deed authenticates exactly one master, and the §7.4 hash record establishes which file that is. The Sole Copy Agreement (§6.3) handles the buyer-trust commitment to source-file deletion contractually rather than through technical filesystem enforcement; no filesystem-side enforcement runs against the creator's devices.

**Optional native Studio.** If batch and source-file management become real bottlenecks for power users, a native desktop helper -- distributed through the platform's website rather than as a browser extension -- can layer on top of the web app for creators who opt in. The protocol's position is a native application rather than a browser extension: native distribution avoids per-browser approval cycles, MV3 transition risk, Safari-coverage gaps, and the install-and-permission-grant friction that filters out a fraction of creators.

The platform does not modify the visible content of the creator's file. The master is uniquely identifiable as the deed-bound artifact through its on-chain content-hash anchor (§2.1), not through any embedded mark.

### 6.2 Content Uniqueness Enforcement

Every Master Image must contain visibly distinct content. A minor crop, filter adjustment, or color shift of an existing Master does not constitute distinct content. This mirrors how the music industry enforces master recording uniqueness and how stock photography licenses cover distinct compositions. The platform enforces uniqueness through a legal layer (Exclusive License, Section 3; Sole Copy Agreement, Section G.1.3) and a technical layer (two-tier algorithmic detection at ingestion).

**Tier 1: Near-Duplicate Matching.** Every upload is checked against a near-duplicate image match service indexed over all minted Masters. The service is purpose-built for exact and near-duplicate detection -- it recognizes a Master that has been re-encoded, resized, cropped, color-shifted, or partially occluded -- and returns a relevance-scored match against the indexed corpus. The index is built from Gallery's own Master corpus and is rebuildable if the matching service is changed.

**Tier 2: Semantic Similarity.** An embedding-based similarity service indexes every minted Master as a dense feature vector and surfaces conceptually and compositionally similar images that near-duplicate matching misses -- a distinct photograph of the same scene, or a close stylistic imitation. Like the Tier 1 index, the embedding index is derived from the owned Master corpus and is rebuildable if the similarity service is changed.

**Ingestion Pipeline.** The platform indexes every minted Master in both the near-duplicate match service and the embedding similarity service. New uploads are compared at two levels: (i) per-creator at a calibrated similarity threshold accounting for stylistic consistency across the creator's body of work, and (ii) platform-wide at a stricter threshold detecting cross-creator duplication. Per-creator hits are rejected with feedback identifying the conflicting Master from the same creator. Cross-creator hits at the platform-wide threshold gate the upload pending §6.7 Provenance and Rights Verification (cross-creator duplication may reflect legitimate independent licensing, public-domain re-use, or content theft requiring rejection -- the §6.7 gate determines which).

**Enforcement.** Per-creator duplicate or near-duplicate uploads are blocked at ingestion. Cross-creator duplicates are routed to §6.7 rights resolution rather than being directly blocked. Repeated attempts to circumvent the uniqueness gate through adversarial manipulation trigger graduated penalties: first offense warning, second offense temporary minting suspension, third offense permanent platform removal.

### 6.3 Sole Copy Agreement

The Sole Copy Agreement operates as the contractual layer of a two-layer scarcity architecture. The technical layer is the on-chain content-hash anchor (§2.1): the deed authenticates exactly one master, and the §7.4 hash record fixes which file that is. The technical layer establishes which file the deed certifies; it does not by itself guarantee that no other full-resolution copy of the work exists. The contractual layer of the Sole Copy Agreement closes that gap: it expresses the creator's commitment to source-file destruction in a form buyers can read and trust without understanding the underlying cryptographic provenance, mirroring the signed-and-numbered conventions, plate-destruction rituals, and master-tape-destruction commitments long established in the limited-edition print, music, and high-end art markets.

At mint finalization, the creator executes a Sole Copy Agreement committing to the following obligations:

1. The creator acknowledges that the Master Image certified by the deed and recorded by its on-chain content-hash anchor (§2.1) is the unique deed-bound artifact, and that the creator's pre-upload source file, even if pixel-identical, is not the deed-bound artifact.
2. As a buyer-trust commitment, the creator agrees to destroy the pre-upload source file and all backups, cloud-storage instances, and derivative full-resolution copies on the creator's own devices and services after mint completion.
3. The creator agrees not to distribute the full-resolution file through any channel outside the platform.
4. The creator agrees not to recreate or produce substantially similar versions of the minted Master.

The creator self-attests destruction at mint completion via an ESIGN-compliant clickwrap acknowledgement; the image page surfaces a "creator-certified source destruction: [timestamp]" line as buyer-facing disclosure. No filesystem-side enforcement runs against the creator's devices.

After mint, the creator retains access to the degraded Gallery preview version for promotional use (social media, YouTube thumbnails, website) and can link to the Gallery page. The creator cannot download or access the full-resolution Master; only the deed holder can.

**Detection and remedy.** Breach of the Sole Copy Agreement is detectable when a full-resolution copy of the work surfaces in distribution channels outside the platform's authorized paths: the near-duplicate match service and the embedding similarity service (§6.2) match the minted Master at high similarity. This evidence is admissible for the graduated-penalty path. Penalties: first offense warning and temporary minting suspension, second offense permanent minting suspension, third offense permanent platform removal and forfeiture of all royalty streams. The §6.2 uniqueness gate independently prevents the creator from re-minting the same source under a different identity; the gate operates on visual content through those two services.

The two-layer architecture (on-chain anchor plus contractual commitment) does separate jobs: the content-hash anchor fixes which master the deed authenticates, and the Sole Copy Agreement converts that into a commitment buyers can read and trust without inspecting the cryptographic layer.

### 6.4 Content Authenticity Gate

Authenticated fake images are a category contradiction. Gallery's value proposition is that the deed certifies a real, owned digital artifact. If the artifact itself is fabricated and presented as real -- a generative-model output sold as photography, a deepfake of a real person sold as authentic depiction, an AI-synthesized scene sold as documentary -- authentication operates in service of fraud and the platform's epistemic integrity collapses. The Content Authenticity Gate screens every Master at ingestion for synthetic-content markers and enforces transparent disclosure of origin. The goal is not to prohibit AI as a creator tool but to prevent undisclosed synthetic content from being authenticated as if it were captured or hand-produced.

The Gate is a Day-1 requirement, not a feature deferred to adjacent-market activation. The deepfake-of-real-person check in particular is non-negotiable: the platform does not mint deeds against unconsented synthetic depictions of identifiable people regardless of tier.

**Capture-time provenance.**

C2PA-based capture-origin verification was considered as an authenticity layer and is not adopted as load-bearing in the protocol. The rationale is documented in R67 §5.11 and R67 Appendix F: C2PA's provenance signature is embedded in file metadata that most major social platforms strip during re-hosting, undermining its load-bearing value where Gallery's Share Copies are most likely to circulate. Authenticity rests instead on the §1.4 reputation gate, ESIGN-bound creator attestation, and the §6.2 uniqueness and content-compliance gates documented in this section. Capture-time C2PA reading and image-page surfacing may be introduced if the regulatory environment or consumer-recognition trajectory shifts; the deed and verification primitives are independent of C2PA, and a C2PA layer can be added without architectural disruption.

**C2PA AI-generation precheck.**

Distinct from the capture-origin verification above, a C2PA manifest can also carry a signed AI-generation assertion written by the generating tool. Reading it is near-free -- signed-metadata parsing, not classifier inference -- and a present, valid assertion is cryptographically trustworthy. The protocol provides for this as a positive precheck ahead of the two-tier Synthetic-Content Detection Track below: a manifest that declares AI generation delivers a high-confidence, signature-backed origin signal at near-zero cost, corroborating the creator's origin declaration where it matches and supplying an immediate false-disclosure trigger where it contradicts a "Captured" or "Hand-produced" declaration. The precheck is positive-only and does not change the gate's posture: a missing or AI-silent manifest is uninformative, covering neither generators that omit C2PA nor manifests stripped on re-export, so every Master still runs the full detector track regardless of the precheck result. It clears the honest, self-labeled cases cheaply, never substitutes for detection, and never treats manifest absence as evidence of authentic capture.

**Synthetic-Content Detection Track.**

Every Master is run through a two-tier synthetic-content detector at ingestion regardless of creator self-disclosure. Detection is independent of declaration.

| Tier | Method | What it detects |
|---|---|---|
| Tier 1: Pixel-level forensics | Error-level analysis, JPEG-quantization-table consistency, sensor-noise (PRNU) pattern | Region tampering (face-swap inserts), recompression patterns from "screenshot of an AI image" laundering |
| Tier 2: Generative-model fingerprints | Diffusion-model artifact classifier, GAN-fingerprint detector (Sensity-class API or self-hosted equivalent) | Whole-image generation (Midjourney, DALL-E, Stable Diffusion, Flux), face-swap composites |

Tier 2 outputs an authenticity-confidence value in {high, medium, low} which is recorded in the deed metadata and displayed on the image page.

**Deepfake-of-Real-Person Detection.**

A specialized check runs face-recognition against a public-figure index (entertainers, politicians, executives, athletes, public-presence individuals) at ingestion. Detected matches gate the upload until the creator either:

1. Provides written consent from the depicted person uploaded as part of the mint package, hash-bound to the deed, or
2. Discloses the image as a synthetic depiction with the depicted person's name and a "not the actual person" disclosure on the image page, where consent terms or jurisdictional law permit such depiction (parody, satire, commentary), or
3. Establishes that the depicted person is the creator themselves -- verified through face-match against the three-layer creator identity chain (Section 3.1).

Without one of these three resolutions, the upload is rejected. Detected matches that resolve as the creator's own likeness pass automatically. Private-figure consent infrastructure (for non-public-figure individuals who opt into platform likeness-protection) is forward-looking and activated alongside adjacent-market expansion.

**Disclosure Requirement.**

At mint, the creator declares the Master's origin via a structured field with four values:

| Origin declaration | Meaning | Treatment |
|---|---|---|
| Captured | Hardware-camera or scanner capture; no generative AI in pipeline | Tier 2 score must be high; deed labeled "Captured" |
| Hand-produced | Digital illustration, painting, or design by the creator without generative AI; conventional editing tools acceptable | Tier 2 score must be high or medium; deed labeled "Hand-produced" |
| AI-assisted | Generative AI used in part of the workflow; creator finalizes the Master | Tier 2 results recorded; deed labeled "AI-assisted" with disclosure of which tools |
| AI-generated | Master is primarily a direct generative output, with or without conventional editing | Tier 2 results recorded; deed labeled "AI-generated" with model disclosure |

The origin declaration is a creator warranty executed at mint. False disclosure -- where Tier 2 detection contradicts the declaration with high confidence -- triggers graduated penalties on the platform pattern established in Sections 6.2 and 6.3: first offense warning and temporary minting suspension, second offense permanent minting suspension, third offense permanent platform removal and forfeiture of all royalty streams.

**Reverse-Image Pre-Check.**

At ingestion, the upload is checked against major public image indices (web image search, public stock-photo databases) for prior appearances. Prior-appearance hits feed the §6.7 Provenance and Rights Verification Gate for rights resolution: hits within the creator's verified-portfolio corpus (Section 3.1 Creator Portfolio Verification) classify as creator's own prior work and pass with informational disclosure on the image page; hits outside the corpus trigger the §6.7 rights-resolution workflow (creator's own prior work on unverified domain, public domain, third-party licensed, ownership proof required, or rejection). Buyers receive transparency on prior web existence regardless of resolution path.

**Tier-Graduated Enforcement.**

The Gate operates at three escalating enforcement levels matched to the Master's intended market:

| Tier | Markets | Synthetic detection | Deepfake check | Disclosure | Reverse-image | Edit acceptance |
|---|---|---|---|---|---|---|
| Default (creator merchandise) | Creator-illustration, design, AI-assisted creator work | Required (informational + rejection only on undisclosed synthetic content) | Required (gating) | Required (gating; all four origin values acceptable) | Informational | Any; summary on image page |
| Photographer-verified (R66 §6.1 Year 2) | Authenticated photography | Required (gating; AI-generated origin rejected) | Required (gating) | "Captured" only | Informational | Editorial only; compositing requires `Edited` tag |
| Journalistic (R66 §6.1 Year 3+) | Documentary photojournalism | Required (gating) | Required (gating) | "Captured" only | Required (no prior public appearance permitted) | Darkroom standard; compositing or AI rejected |

**Edit-acceptance details.** The Default tier accepts any edits with the creator's disclosed edit summary surfaced on the image page. The Photographer-verified tier permits editorial-use edits (crop, color, exposure, white-balance, format conversion); compositing edits (element placement, element removal, synthesis) require an explicit `Edited` disclosure tag on the image page. The Journalistic tier applies the NPPA / AP / Reuters darkroom-equivalent standard: only crop, color adjustment, and format conversion are accepted; element placement, element removal, synthesis, or AI generation reject the upload.

The default tier is active at platform launch and is the operational scope for the creator-merchandise wedge. Photographer-verified and journalistic tiers are activated as part of adjacent-market expansion and require additional onboarding infrastructure.

### 6.5 Right-of-Publicity Gate

The Right-of-Publicity Gate screens every Master at ingestion for depictions of identifiable real persons and gates the upload until one of three resolution paths is satisfied. The gate addresses state-law right-of-publicity exposure under New York Civil Rights Law Sections 50-51, California Civil Code Section 3344, the Restatement (Third) of Unfair Competition Section 46 (1995), and the broader state-law regime documented in R67 §5.11. Exposure attaches whenever a Master depicts an identifiable real person whose likeness is used commercially without consent, regardless of whether the depiction is photographic (real capture), composite (real photo with synthetic elements), or fully synthetic (AI-rendered likeness).

The gate is a Day-1 hard requirement. The platform's three-layer creator authentication (Section 3.1) makes the creator personally identifiable and individually liable for false consent claims; the platform's exposure is secondary but joint and several under Lanham Act Section 43(a) and California Civil Code Section 3344(a). A single high-profile right-of-publicity action would inflict platform-level reputation damage that subsequent remediation cannot reverse.

**Identifiable-Person Detection.**

Face recognition runs at ingestion against two indices:

| Index | Coverage | Source |
|---|---|---|
| Public-figure index | Entertainers, politicians, executives, athletes, public-presence individuals (~150K-200K identities) | Industry-standard public-figure databases (PimEyes-class face-search APIs or self-hosted equivalents on public-domain biographical photo corpora) |
| General-population face presence | All identifiable-person depictions regardless of public-figure status | Face-detection model (RetinaFace, MTCNN, or current state-of-the-art equivalent); does not perform identity match -- only detects "an identifiable person is depicted" |

The public-figure index is hash-based (face-embedding similarity, not stored facial images) to comply with biometric-data regulations under Illinois BIPA and California SB-1001. The general-population face-presence detector is a binary classifier that flags depictions for resolution-path enforcement without performing identity match.

**Resolution-Path Enforcement.**

A Master flagged by either index is gated until the creator satisfies one of three resolution paths.

*Consent (Model Release).* The depicted person executes a model release granting commercial-use rights for the specific Master and its derivative renderings. The release is uploaded as part of the mint package, hashed, and bound to the deed via on-chain pointer. Required fields: depicted-person legal name, date of birth, signature (electronic per ESIGN per R67 §5.6), date of execution, scope of grant (commercial use, gallery display, resale), governing law (Delaware default, with state-of-residence override for the depicted person where applicable). The release template is platform-provided to ensure scope sufficiency under the strictest applicable state regime. Bulk releases (multiple Masters from a single photoshoot) are supported.

*Editorial-Use Exemption.* For Masters claiming editorial-use exemption under the Hoepker-line authority (newsworthy event, public-figure-in-public-place doctrine, commentary, parody, satire), the creator provides a written editorial-context declaration as part of the mint package. The declaration must include the newsworthy event or public-context basis, the date and location, and the editorial-context category. The declaration is hashed and bound to the deed. The platform does not adjudicate the merits of the editorial-use claim at ingestion -- the declaration shifts the affirmative-defense burden to the creator's editorial declaration in the event of a right-of-publicity action. Editorial-use Masters are tier-restricted to the journalistic tier (R66 §6.1 Year 3+ market) at full enforcement; default-tier editorial-use claims trigger manual review.

*Creator-as-Subject.* The depicted person is the creator themselves. Resolution is automatic upon face-match between the depicted person and the creator's three-layer identity chain (Section 3.1 plus the creator-photo captured during identity verification). Match confidence above the calibrated threshold passes the gate without further action.

**Treatment by Origin Declaration.**

The Right-of-Publicity Gate operates in parallel with the §6.4 Content Authenticity Gate. The two gates address different legal exposures (right-of-publicity vs content-authenticity) but jointly cover the depicted-person landscape:

| Origin (per §6.4) | Identifiable-person presence | Right-of-Publicity Gate enforcement |
|---|---|---|
| Captured / Hand-produced (real depiction) | Detected | Gate enforced; one of three resolution paths required |
| AI-assisted / AI-generated (synthetic depiction) | Detected | Gate enforced; same three resolution paths apply |
| Any origin | Not detected | Gate passes |

The platform does not differentiate consent requirements between real and synthetic depictions because the legal exposure under post-ELVIS-Act state regimes does not differentiate. The §6.4 deepfake check addresses the technical-authenticity layer; the §6.5 gate addresses the right-of-publicity layer; the two run as parallel admission requirements.

**Failure Mode and Penalties.**

False consent claims (e.g., uploading a forged model release) constitute a contractual warranty breach paralleling the §6.3 Sole Copy Agreement and §6.4 origin-declaration warranty. Detection mechanisms include depicted-person complaints, third-party signature-validity challenges, and routine consent-document audit. Graduated penalties follow the platform pattern: first offense warning and temporary minting suspension, second offense permanent minting suspension, third offense permanent platform removal and forfeiture of all royalty streams.

### 6.6 Content Moderation Gate

The Content Moderation Gate screens every Master at ingestion through four classifier layers and applies hard-rejection-or-tier-classification based on the output. The gate addresses the federal CSAM mandate under 18 U.S.C. Sections 2251, 2252, 2252A, the Section 2258A NCMEC reporting obligation, the Take It Down Act (2025) NCII regime, state NCII statutes, and the payment-rail compliance requirements under Visa Core Rules, Mastercard Standards, and Stripe / PayPal Restricted Businesses. The full legal foundation is documented in R67 §5.12.

The gate is a Day-1 non-negotiable requirement. CSAM hash-matching is the legal floor below which no image platform may operate; failure to implement risks federal criminal exposure, payment-rail termination, and platform-level reputation collapse.

**Tier 0: PhotoDNA / NCMEC Hash-Matching (Hard Floor).**

Every Master is hash-matched against the NCMEC CyberTipline known-CSAM index synchronously at ingestion before any other processing. The hash-match infrastructure uses Microsoft PhotoDNA (free for qualifying ECS and RCS providers) and the Tech Coalition's industry-standard hash-sharing infrastructure. A match triggers the following sequence:

| Step | Action |
|---|---|
| 1 | Hard-rejection of the upload; Master and derivatives deleted from staging storage |
| 2 | Immediate creator account suspension pending investigation |
| 3 | Section 2258A NCMEC CyberTipline report filed within the 60-day statutory deadline (operationally within 24 hours) |
| 4 | Law enforcement referral per platform standard procedure |
| 5 | Permanent platform removal of the creator's account and forfeiture of all royalty streams |

The Tier 0 layer is non-skippable and runs before any quality, uniqueness, authenticity, or right-of-publicity check. The platform operates under Section 2258B good-faith immunity for the report itself and any incidental retention required for law enforcement compliance.

**Tier 1: AI-CSAM Classifier (Hard Floor).**

PhotoDNA covers known CSAM but cannot detect AI-generated CSAM, which is by definition novel and absent from the index. A second hard-floor layer runs a classifier trained for synthetic CSAM detection (Thorn Safer-class API or self-hosted equivalent on Thorn's CSAM-detection model). Detection follows the Tier 0 sequence: hard rejection, account suspension, Section 2258A report (CSAM is treated identically regardless of whether the depicted child is real or synthetic per the PROTECT Act and state AI-CSAM statutes), platform removal.

**Tier 2: NCII Classifier (Hard Floor).**

Non-consensual intimate imagery detection runs as a separate classifier addressing both real-photographic NCII and synthetic NCII. The classifier complements the §6.5 Right-of-Publicity Gate's deepfake-of-real-person check: §6.5 catches the consent dimension; §6.6 Tier 2 catches the intimate-imagery dimension. Detection triggers hard rejection plus Take It Down Act takedown procedures plus, where applicable, state-NCII-statute reporting.

**Tier 3: Adult-Content Classifier (Tier-Graduated).**

Above the hard floors, an adult-content classifier produces a four-value classification recorded in the deed metadata and used for tier admission and discovery surface eligibility. The classifier integrates outputs from Hive Moderation, Google Cloud Vision SafeSearch, and Amazon Rekognition (or self-hosted equivalents on equivalent training corpora):

| Classification | Classifier signal | Default tier (launch) | Adult tier (forward-looking) |
|---|---|---|---|
| G | "Very Unlikely" / "Unlikely" on adult, racy, violence detectors across all classifier APIs | Permitted | Permitted |
| Suggestive (Racy) | "Possible" / "Likely" on racy detector but below adult threshold | Restricted to art-tagged listings; not surfaced in general discovery; not eligible for Stripe primary-rail processing | Permitted |
| Adult (NSFW) | "Likely" / "Very Likely" on adult detector | Rejected | Permitted with adult-content payment processor (CCBill, Verotel, Segpay) and age-verified buyer access |
| Prohibited | CSAM (covered by Tier 0/1), NCII (covered by Tier 2), violence-against-persons, exploitation indicators | Rejected with Section 2258A report (CSAM) or Take It Down Act takedown (NCII); rejected with manual review for other Prohibited categories | Same |

The default-tier G-rated requirement is what enables the platform's Stripe Connect payment integration (Section 2.4); it is what allows discoverability surfaces (web-search indexing, social-media share previews) to function without trigger-level content classifications. The default tier serves the creator-merchandise wedge (R66 §6.1) and is the operational scope at platform launch.

The adult tier is forward-looking and not part of the launch product. Its activation would require parallel infrastructure (separate MCC merchant accounts via specialized adult-content processors, mandatory age verification for buyers, segregated discovery surfaces, separate marketing-language posture for SEC and Howey purposes). Activation timing is not currently scoped.

**Classifier-Calibration Considerations.**

Adult-content classifiers exhibit non-zero false-positive and false-negative rates. Calibration thresholds are set conservatively (favoring rejection at the boundary) to maintain payment-rail compliance margins. Manual-review queues accept creator appeals for false-positive rejections; the appeals process targets a 24-hour resolution time. False-negative leakage to default-tier discovery is contained by post-ingestion classifier re-runs as classifier models update, with retroactive deed-metadata updates and tier reclassification where warranted.

The classifier output for ambiguous-context content (art-context nudity, classical-art reproductions, medical-context imagery) defaults to Suggestive classification rather than G; creators with art-context Masters that classify as Suggestive may file an art-context exemption request that, on manual review, can promote to G.

### 6.7 Provenance and Rights Verification Gate

The Provenance and Rights Verification Gate addresses the residual risk that a Master's content originates from a source where the creator does not hold the rights necessary to convey object-instance ownership and platform-level exclusivity. The gate operates as the rights-resolution layer downstream of §6.4 Reverse-Image Pre-Check and §6.2 Content Uniqueness Enforcement (cross-creator tier). The legal basis is documented in R67 §5.4 (Copyright Statutory Framework) and §5.5 (DMCA Statutory Framework); the threat model is documented in R65 §3.1 (AI-Generated Content Submitted as Human Work, attack path 3 -- minting third-party content under one's own authentication).

The gate is a Day-1 hard requirement. Catalog contamination from copyright theft is structurally identical to catalog contamination from undisclosed AI-content: individual instances are recoverable through the dispute channel and creator reserve, but accumulation destroys catalog trust at scale (R65 §3.1's "uncontrolled accumulation is existential" framing applies symmetrically to both content-fraud categories).

**Trigger Conditions.**

The §6.7 gate activates on any of three signals from earlier ingestion stages:

| Signal source | Trigger condition |
|---|---|
| §6.4 Reverse-Image Pre-Check | Prior public appearance detected outside the creator's verified-portfolio corpus |
| §6.2 Content Uniqueness (platform-wide tier) | Cross-creator duplicate detected at the stricter platform-wide threshold |
| Creator declaration | Creator declares Public Domain or Third-Party Licensed origin at mint |

A Master that triggers any of these signals is gated until rights resolution.

**Rights-Resolution Paths.**

Five resolution paths exist:

| Resolution | Path | Gate Behavior |
|---|---|---|
| Creator's own prior work | Reverse-image hit within the creator's verified-portfolio corpus from §3.1 Creator Portfolio Verification (creator-verified domains, OAuth-bound social handles) | Pass with informational disclosure on the image page recording prior-appearance URLs |
| Public Domain origin | Creator declares Public Domain at mint with source classification (expired copyright, U.S. government work per 17 U.S.C. §105, CC0 dedication, public-domain dedication by author); platform may verify against public-domain databases (Wikimedia Commons, Public Domain Review, government archives) | Pass; deed labeled "Public Domain"; deed-rights articulation per §3.3 Public-Domain Tier amendment; per-creator velocity limit applies |
| Third-Party Licensed | Creator submits license document (CC-BY, CC-BY-SA, paid stock license per platform-recognized providers, custom license document) hash-bound to the deed, with declaration of license type and scope-of-grant assertion | Pass; deed surfaces license terms and license-document hash; deed-rights articulation per §3.3 Third-Party Licensed Tier amendment; downstream resale capability subject to license-scope inheritance |
| Cross-creator duplicate (legitimate independent use) | Both creators provide independent rights documentation under one of the above paths (e.g., both legitimately licensed the same stock photo, or both minted from the same public-domain source) | Both pass; deeds cross-reference each other in metadata; buyers receive disclosure of non-exclusive duplication and the cross-reference URL |
| No valid resolution | None of the above resolutions; creator cannot establish rights to the underlying work | Rejected; creator account flagged for review; repeat violations follow the graduated-penalty pattern |

**Verified-Portfolio Corpus.**

The creator's portfolio verification at onboarding (§3.1 Creator Portfolio Verification) populates the corpus used by the first resolution path. Verification methods:

| Source | Verification method |
|---|---|
| Personal portfolio domain | DNS TXT-record verification matching a platform-issued challenge token |
| Social-platform handles | OAuth binding via platform APIs (Instagram, X, ArtStation, Behance, etc.) where available; manual verification with platform-issued challenge for platforms without OAuth |
| Prior creator-platform handles | OAuth or API binding (Patreon creator authentication, Substack publication binding) |
| Public archive contributions | Self-attestation plus platform spot-check against archive contribution records |

Verified-portfolio binding is one-way attribution: the platform learns where the creator has previously published, not the converse. Reverse-image hits within the corpus pass; hits outside trigger the rights-resolution workflow.

**Public-Domain Velocity Limit.**

The platform applies a per-creator rate limit on Public Domain-declared mints to prevent catalog dilution from bulk public-domain reproduction. The structural concern is that without a velocity limit, a single creator could mint the entirety of a major museum's open-access collection (Metropolitan Museum, Smithsonian Open Access, Rijksmuseum) as Masters, compromising the catalog's curation density without contributing original or rights-cleared work. The per-creator velocity limit is calibrated administratively and may be raised on case-by-case review for legitimate public-domain curation projects.

**Failure Mode and Penalties.**

False rights claims (forged license document, false Public Domain declaration, false self-attestation of prior-work ownership) constitute a contractual warranty breach paralleling the §6.3 Sole Copy Agreement, §6.4 origin-declaration warranty, and §6.5 model-release warranty. Detection mechanisms include third-party copyright complaints under DMCA §512(c), license-issuer challenges, and routine rights-document audit. Graduated penalties follow the platform pattern: first offense warning and temporary minting suspension, second offense permanent minting suspension, third offense permanent platform removal and forfeiture of all royalty streams.

DMCA §512(c) takedown requests targeting deeds where rights-resolution proves to be false trigger immediate deed-state transition: the underlying Master is removed from active distribution, the deed is marked rights-disputed, and the creator's account is suspended pending investigation. Resolved DMCA disputes either restore the deed (counter-notice prevails) or permanently invalidate it with buyer-refund from the creator reserve.

### 6.8 Malware Detection Gate

Image files are a malware vector. Steganographic payloads, polyglot files (a single file that is both a valid image and a valid script or executable), and malicious metadata structures (EXIF / XMP / ICC fields containing exploit code targeting parser vulnerabilities) can all be embedded in image artifacts that pass standard format validation. The platform protects buyers, the creator's account integrity, and platform infrastructure by gating Master ingestion against malware before the Original enters Commerce operational custody.

**Architectural premise.** The Original held in Commerce encrypted custody is the creator's bit-exact upload after the §6 gates clear; it is **not** a re-encoded artifact. The earlier R62 design wrote a defensive re-encoded canonical artifact to custody; that design has been retired. Two reasons motivate the change. First, an all-files re-encoding pass that mutates every Original silently breaks the artifact-integrity expectation (the bytes the creator signed are the bytes Gallery custodies). Second, buyer-side malware exposure is already eliminated structurally by the variant pipeline (see Buyer-Side Safety Guarantee below); a custody-side re-encoding pass adds no further protection against the buyer-facing surface and so its only function would be to launder the Original itself, which is exactly what the new design refuses to do.

**Multi-Layer Scanning Architecture.**

| Layer | Detection target | Implementation | Action on detection |
|---|---|---|---|
| Format-conformance validation | Polyglot files; truncated or malformed structures that crash downstream renderers; chunks containing executable signatures inside PNG / JPEG / TIFF containers | libpng / libjpeg-turbo strict-mode parsers with all-warnings-as-errors; reject any file that fails strict round-trip decode | Reject |
| Metadata sanitization | Malicious EXIF / XMP / ICC fields containing scripts, oversized chunks, or known exploit signatures | Strip all non-essential metadata at ingestion; preserve only platform-required fields (creator identity, creation date, XMP/IPTC provenance per §3.2); validate retained fields against schema | Reject if exploit signature; otherwise sanitize and proceed |
| Embedded-payload scanning | Steganographic payloads (LSB encoding, DCT-coefficient hiding) that may carry executables, exfiltration channels, or covert content; AV-engine positive signatures | Statistical steganalysis pass with calibrated entropy thresholds; signature-based scan via commercial AV engine (ClamAV minimum, third-party engine for high-volume creators) | Reject |

The three layers run in sequence at ingestion. If any layer detects malware, the file is rejected and the Original never enters Commerce custody. There is no all-files re-encoding backstop. The Original that enters custody is byte-identical to the creator-uploaded source, modulo the metadata-sanitization layer (non-essential fields stripped, platform-required fields validated) which is content-preserving with respect to pixels.

**Detection Actions.**

| Detection severity | Action |
|---|---|
| Format-conformance failure (corrupted file, parser crash) | Immediate rejection at upload with creator-facing diagnostic ("file failed format validation -> re-export from source"); no creator account flag |
| Metadata-sanitization, non-malicious (suspicious or non-essential fields stripped) | File proceeds to next layer; creator notified that metadata was stripped; no account flag |
| Metadata exploit signature | Immediate rejection; file quarantined for forensic review; creator account flagged per §6.4 origin-declaration warranty failure mode |
| Embedded-payload detection (positive AV signature, statistical steganalysis flag, known exploit pattern) | Immediate rejection; file quarantined for forensic review; creator account flagged per §6.4 origin-declaration warranty failure mode |

Embedded-payload detection produces a creator-account incident that follows the graduated penalty pattern from §6.5 and §6.7: first incident triggers warning and temporary minting suspension pending review (the upload may be a false positive on a legitimately complex image); second incident triggers permanent minting suspension; third incident triggers permanent platform removal.

**Buyer-Side Safety Guarantee.**

The buyer-side safety guarantee is structural and lives in Commerce's variant pipeline, not in any custody-side re-encoding pass. Every customer-facing artifact (Listing preview, Thumbnail, Share Copy, Keepsake Copy, platform-delivered Master Image) is composed from the Original by Commerce's Cloudinary-backed variant build pipeline on demand. Each variant is decoded, transformed (resize, monogram overlay, in-pixel URL text for the Share Copy and Keepsake Copy, format conversion to JPEG / WebP for delivery), and re-encoded to canonical form. The Share Copy is re-encoded by construction every time it is built; the same holds for the Keepsake Copy when creator-enabled, and for the Listing preview, Thumbnail, and platform-delivered Master Image. The Cloudinary transformation pipeline operates on decoded pixel buffers, not on the source file's container; any steganographic payload encoded in source-file byte layout, in source-file metadata chunks, or in lossless-format LSB structure does not survive the transformation. The buyer-side delivery path is therefore free of creator-uploaded malware as a structural property of variant production, not as a property of any scan that ran at custody. Buyers do not need to trust that the platform's malware scan was perfect; they only need to trust that the Cloudinary variant pipeline ran. This property is buyer-relevant and cited as the "Content quality (no malware)" attribute in R66 §1.2.

The Original itself, held in Commerce encrypted custody, is exposed only to the deed holder on Master download (which routes through Commerce's protected-render path, §7.5) and is never delivered to a buyer in any other path. The deed-holder download is the one path where a non-re-encoded Original reaches a buyer, and that path is gated by the §6.8 reject-on-detection architecture above; a creator who introduces a payload that survives all three detection layers and reaches the deed-holder Master download surface is the residual exposure, which the §6.7 graduated penalty and the §6.4 origin-declaration warranty address contractually.

### 6.9 Content Grading Gate

Content grading is a two-component gate addressing both technical-quality and aesthetic dimensions. The technical component is a binary hard floor enforced at ingestion (parameters in §6 Quality Gate table); the aesthetic component is an assistive scoring mechanism that surfaces to creators as feedback and to buyers as an optional discovery filter, never as a publication gate. The two-component structure is deliberate: technical quality is binary-decidable and reliably gateable, while aesthetic quality is taste-contested and culturally varied, making aesthetic gating likely to produce monocultural output and damage the creator-led publication model.

**Technical Component (Hard Gate).**

Implemented in §6 Quality Gate table and §6.1 local quality checks. Files failing technical thresholds are rejected at upload with specific creator-facing diagnostic. The technical component does not require ML; format-conformance parsers (libpng, libjpeg-turbo strict-mode), resolution and color-depth validators, and file-size floor checks are all deterministic.

**Aesthetic Component (Assistive Scoring).**

Each Master Image receives an aesthetic score from a perceptual quality classifier ensemble at ingestion. The score is recorded in deed metadata, surfaced to the creator as feedback, surfaced to buyers as an optional discovery filter, and used by platform discovery algorithms to inform default-feed ranking. The score does NOT block publication.

| Component | Implementation | Role |
|---|---|---|
| Perceptual quality scoring | NIMA / BRISQUE / LAION-Aesthetic predictor or commercial equivalent | Technical-aesthetic baseline (composition, exposure, sharpness, noise) |
| Composition analysis | Rule-of-thirds, leading-lines, color-balance scoring | Composition-quality dimension |
| Subject-coherence | CLIP-based image-text alignment | Detects visually incoherent or off-subject images |
| Spam/junk detection | Combined low aesthetic + low coherence + uniqueness flag | Triage signal for manual review of suspected spam |

**Why aesthetic scoring is assistive, not gating.**

Aesthetic classifiers score reliably on Western-mainstream-photography distributions but poorly on legitimate traditions (street photography, raw documentary, conceptual minimalism, abstract work, vernacular and snapshot aesthetics, regional traditions). Using such a classifier as a gate creates aesthetic monoculture and breaks the creator-led publication model (R66 §1.4); curated platforms with aesthetic gates (KnownOrigin, SuperRare) produced low-volume product cells, while open marketplaces without them (OpenSea) produced higher volume with buyer-side-filterable signal-to-noise issues instead.

The platform's resolution: hard technical floor (binary, no taste content), assistive aesthetic score (advisory, buyer-controlled).

**Use as Tier-Graduation Signal.**

Aesthetic scores feed into the §6.4 Tier-Graduated Enforcement layer as one input among several (creator-self-attestation, creator account history, creator OAuth chain, manual review where applicable). High aesthetic score does not automatically promote to a higher tier (Photographer-verified, Journalistic) -- those tiers require explicit verification per §6.4 -- but it can be used by the platform's curation surfaces (featured drops, default-feed prominence) where verified-tier admission is not required.

**Buyer-Side Filtering.**

The Gallery discovery surface offers buyers an optional filter on aesthetic score (and other ranking signals: recency, edition tier, creator subscriber count, social signaling indicators). Buyers can elect to see all content (no filter), high-aesthetic content only, or curator-recommended content (an editorial layer above the algorithmic score). The buyer's filter choice does not affect creator publication; it affects what the buyer sees.

**Cost Structure.**

Aesthetic scoring runs once per Master at ingestion and persists with the deed metadata. Re-scoring on classifier-model updates is supported but not performed automatically (creator-side stability concern). Per-image classifier inference cost is sub-cent on commodity ML infrastructure and is accounted in R61 Platform Cost Analysis.

## 7. TECHNICAL ARCHITECTURE

### 7.1 Backend Infrastructure

The protocol runs on the following core technical stack.

| Component | Technology | Function |
|---|---|---|
| NFT Minting | Solana Metaplex standard | On-chain Master Image deed with license parameters |
| Original Storage | AWS S3 Glacier Instant Retrieval + AWS KMS (or equivalent) | Server-side encrypted-at-rest custody of the clean source; canonical workhorse for every variant build |
| Master Storage | Arweave encrypted | Per-owner trustless archive layer; immutable per-deed encrypted Master with doubly-nested `enc_final = encrypt(encrypt(DEK_image, owner_wallet_pubkey), platform_DEK)` carried in deed metadata; recoverable per-owner post-cessation via trustee publication of `platform_DEK` and the current owner's wallet key |
| Image Match Engine | TinEye MatchEngine (or equivalent near-duplicate matcher) | Near-duplicate visual matching: re-encoded or cropped variant recognition, ingestion uniqueness (§6.2 Tier 1), leak and infringement detection; index rebuildable from the owned Master corpus |
| Semantic Similarity | Mixpeek (or equivalent embedding search service) | Embedding-based conceptual and compositional similarity (§6.2 Tier 2); index rebuildable from the owned Master corpus |
| Identity Verification | Digital passport | Creator and owner verification |
| Web2 Abstraction | Crossmint/Magic wallets (Doc R35) | Invisible blockchain interactions |
| On-chain Deed | NFT ownership record | Provenance, transfer tracking, license state |
| Gallery | Separate web application (Section 4) | Discovery, viewing, primary + secondary Master sales |
| Payment Processing | Stripe Connect (Doc R35) | Fiat Master purchases with automated splits |
| Token Gating | Smart contract verification | Gallery viewing fee collection |

### 7.2 Gallery Technical Architecture

The gallery is a standalone web application with its own domain. This separation serves three purposes: it positions the gallery as a cultural institution, it allows independent scaling and design optimization for discovery-focused browsing, and it avoids commingling the aesthetic experience with financial transaction interfaces (consistent with the self-transcendence research in R67 §2.5).

| Component | Technology | Function |
|---|---|---|
| Frontend | Responsive web application | Gallery browsing, search, discovery |
| Image Rendering | Four-layer glass-box engine (Section 4.4) | Canvas/WebGL rendering with structural, intentional, categorical, and deliberate glass layers; anti-save measures |
| Metadata API | On-chain + platform database | Real-time provenance and ownership data |
| Search Engine | Indexed metadata + full-text search | Creator, tag, category, and keyword search |
| Token Gating | Smart contract verification | Token fee collection for member access |
| Transaction Engine | Solana smart contract | Primary/secondary Master sales, license migration |
| Analytics | Gallery-specific tracking | View counts, discovery paths, sales conversion |
| Social Link Previews | Open Graph + Twitter Card meta tags | Rich image previews when gallery links are shared on social platforms |

**Social Link Sharing.** Every artifact page serves Open Graph (`og:image`, `og:title`, `og:description`) and Twitter Card meta tags. When a gallery link is posted on any social platform, the platform fetches these tags and renders a rich preview card displaying the glass-box protected image (Layer 3 categorical glass with institutional frame, watermark, and compression). The original file is never exposed. This requires no custom integration per platform -> OG is the universal standard supported by Twitter/X, Discord, iMessage, Facebook, LinkedIn, and all major social networks.
### 7.3 CMS and CDN Infrastructure

The gallery leverages external services for content management and image delivery, limiting custom development to access-controlled rendering.

**Layer 1: Headless CMS (Strapi).** Open-source, self-hostable CMS (Node.js/TypeScript) managing creator pages, search/discovery (Section 4.2), metadata display (Section 4.3), collection curation, multi-portal content delivery via REST/GraphQL (Section 4.6), SEO, and RBAC. Self-hosting preserves data sovereignty over creator metadata and provenance records.

**Layer 2: Image CDN (Cloudinary).** Handles on-the-fly image transformations: resolution capping, compression control, dynamic resizing, format optimization, and watermark overlays with anti-removal randomization, implementing Glass-Box Layer 2 (Section 4.4) through URL-based parameters.

**Layer 3: Custom Access-Control Renderer.** The server fetches Cloudinary-transformed images server-side and delivers them to the browser through canvas/WebGL rendering with anti-save measures (Section 4.4). This layer enforces token-gated access and micro-fee collection. Cloudinary never serves images directly to end users.

| Layer | Service | Handles | Custom Code |
|---|---|---|---|
| Content Management | Strapi (self-hosted) | Creator pages, search, metadata, SEO, RBAC | Minimal |
| Image Transformation | Cloudinary | Watermarking, resolution caps, compression, CDN | None |
| Access-Control Rendering | Custom frontend | Canvas/WebGL, anti-save, token gating, vault | Full custom |

**Cloudinary asset naming.** Each variant is stored in Cloudinary under a `public_id` of the form `<image-id>-<variant-code>`, the base-36 lowercase image ID (§2.3) joined with the variant code (Listing preview, Thumbnail, Master, Keepsake Copy, Share Copy), rather than a Cloudinary-generated random string. Because the `public_id` is a deterministic function of the image ID and the variant rather than an opaque pointer, three properties follow. First, URL determinism: any frontend or API route holding an image ID can construct any of that image's variant CDN URLs by direct string interpolation, with no database lookup to resolve a separate Cloudinary pointer before rendering a page or grid. Second, schema leanness: the image record carries no additional Cloudinary-handle column to store or index, since the image ID plus variant code is at once the storage key, the API parameter, and the asset tag. Third, recovery integrity: a database restore or index rebuild realigns application records with their physical CDN assets automatically, with no risk of orphaned pointers in either direction. The image ID is lowercase, which keeps this shared identifier unambiguous across the URL path, the CDN key, and case-insensitive surfaces such as downloaded filenames. On download, Cloudinary is instructed to deliver the file under the customer-facing filename defined in §2.3, which is distinct from the stored `public_id`.

**Domain-fronted delivery path.** Consistent with Layer 3, Cloudinary is never a client-facing origin. Rather than a DNS record pointing a subdomain directly at Cloudinary, CDN assets are served from a virtual path on the platform's own domain (for example `epimage.com/cdn/*`), resolved by an application rewrite rule in the platform's existing web routing layer; the web server fetches the transformed image from Cloudinary in the background and returns it to the client. Because the platform already operates its own frontend framework and routing, this adds a route rule rather than new infrastructure. Three properties follow. Every client-visible image URL belongs to the platform domain, so Cloudinary appears in no public address. The platform routing layer is the single point at which access control, the Layer 3 rendering path, caching, and request logging are applied. The transformation vendor is abstracted behind the platform path, so a change of CDN provider alters only the background fetch target and leaves every public URL and the DNS configuration unchanged.

### 7.4 Storage Model

The platform maintains four distinct storage tiers, each with a separate role. Per-image content encryption uses a single shared data encryption key `DEK_image` covering the non-circulating artifacts -- Original, on-Arweave Master, and cached Keepsake Copy -- encrypted with the platform-wide envelope key `platform_DEK` (nested-envelope architecture; rationale in R65 §3.14 Decryption-Key Architecture Rationale). Public-circulation variants are served via CDN and are not encrypted:

| Tier | Content | Encryption / Access | Mutability | Purpose |
|---|---|---|---|---|
| **Server-side (encryption-at-rest custody)** | Original (clean source, post-re-encoding per §6); cached Keepsake Copy (the deed-holder's exclusive variant) | Encrypted with `DEK_image`; `DEK_image` encrypted with `platform_DEK` and persisted alongside (as operational ciphertext) the encrypted bytes; access via the platform's variant-build service alone | Original immutable post-Card 2; Keepsake Copy cached per (deed, owner) pair and regenerated on resale | Canonical workhorse for every variant build; deed-holder ownership custody for the byte-stable Keepsake Copy |
| **CDN (e.g. Cloudinary)** | Listing preview, Thumbnail, Share Copy | Public delivery surface; signed URLs for owner-gated assets where applicable | Built on demand from the Original; bytes may drift across CDN re-encodes without protocol consequence -- verification of these candidates routes through the off-chain match engine (§6.2) and, for the Share Copy, in-pixel URL text (§7.6) | Public render and social-circulation delivery |
| **Arweave** | On-Arweave Master (built once at Card 5 from the Original) | Encrypted with the same `DEK_image` used for the Original. The doubly-nested decrypt blob `enc_final = encrypt(encrypt(DEK_image, owner_wallet_pubkey), platform_DEK)` is stored in on-chain deed metadata; the inner layer rotates to the new owner on each resale via Metaplex Core UpdateDelegate. Arweave bytes immutable for the lifetime of the deed; outer `platform_DEK` envelope makes the ciphertext inert during operational life (cannot be decrypted without platform_DEK) so seal-break is cryptographically enforced | Bytes immutable for the lifetime of the deed | Per-owner trustless archive layer. Post-cessation, trustee publishes `platform_DEK`; anyone decrypts outer layer; only the current deed-holder's wallet can decrypt the inner layer and recover `DEK_image` to decrypt that specific Master |
| **Solana on-chain + platform database mirror** | Deed metadata (Arweave URI, `enc_final` nested encryption, current owner, deed_state, royalty parameters, license parameters, reproduction-rights flag, content hash, `{variant_identity: sha256(canonical_pixels)}` map covering the Master and Keepsake Copy variants and their owner-ordinal successors only); platform database mirrors for fast UI rendering, search indexing, and discovery | Solana is public; database is access-controlled | On-chain state changes are the authoritative source of truth; database syncs from on-chain; variant-hash map is append-only (new entries added at each Master or Keepsake Copy build event, prior entries immutable per Solana finality) | Authoritative ownership, license, and §1.5 public-verifiability anchor for ownership-critical artifacts (see R65 §1.5 / §3.15 / §3.16) |

**Data flow.** Ingestion writes the Original to server-side encrypted-at-rest custody using `DEK_image` (Card 2); `encrypt(DEK_image, platform_DEK)` is persisted alongside (as operational ciphertext) as the operational copy for variant builds. The Listing preview and Thumbnail are built from the Original at Card 2 and delivered through the CDN; no on-chain hash is written for them. Card 5 mint builds the on-Arweave Master from the Original (encrypted with the same `DEK_image`), constructs the nested on-chain ciphertext `enc_final = encrypt(encrypt(DEK_image, buyer_wallet_pubkey), platform_DEK)`, and writes deed metadata on-chain including `enc_final` and `{M+00: sha256(M_pixels)}`. Card 6 personalization builds the Keepsake Copy (cached server-side, encrypted at rest with `DEK_image`) and Share Copy (CDN-delivered, unencrypted public render) from the Original; only the Keepsake Copy's `sha256(E_pixels)` is committed to deed metadata. Master and Keepsake Copy build requests (Card 6 personalization, Master download, resale-time re-personalization) decrypt the Original server-side via decrypting `DEK_image` from the operational `encrypt(DEK_image, platform_DEK)` copy, compose the variant, write the Master or Keepsake Copy sha256 to deed metadata via mint-authority Solana transaction -- the §1.5 public-verifiability anchor specified in R65 §1.5, R65 §3.15, and R65 §3.16. On resale, the inner wallet layer of `enc_final` rotates to the new owner's wallet pubkey via Metaplex Core UpdateDelegate; the platform reconstructs the nested ciphertext from the operational copy. The Share Copy and additional commercial-Share Copy builds (§5.2 degradation engine) emit to the CDN without on-chain hash recording; their verification routes through the off-chain match engine and, for the Share Copy, in-pixel URL text. State changes (resale, takedown, reproduction-rights toggle) originate on-chain first; the database syncs the updated state and the variant-build service reads the on-chain record before any access-gated delivery. The degradation engine (§5.2) verifies the on-chain reproduction-rights flag before processing any commercial-Share Copy request, ensuring the blockchain record governs access even if the database cache is stale.

This separation follows the privacy architecture described in §4.7: Solana stores machine-level data (wallet addresses, mint addresses, transfer transactions, the nested `enc_final`), Arweave stores only encrypted Master bytes (uninspectable without `DEK_image`), the platform database maps machine-level data to human-readable information (names, prices, metadata, provenance), and the server-side Original is held under platform encryption-at-rest custody with the operational `encrypt(DEK_image, platform_DEK)` copy.

### 7.5 Decryption and Rendering Architecture

Commerce (§2.2) supports four delivery operations -- deed-holder Keepsake Copy / Share Copy retrieval, deed-holder Master download, public render, and post-cessation per-owner recovery -- all sourced from the server-side Original (the canonical workhorse per §2.2 Master Image storage) during operational life. The on-Arweave Master is reserved for the post-cessation per-owner recovery path only.

**Deed-Holder Keepsake Copy / Share Copy Retrieval.**

When the authenticated deed holder requests their Keepsake Copy or Share Copy:

1. Verify on-chain that the requesting wallet is the current owner per the deed's `owner` field
2. Verify the image is in sealed or opened state (not rights-disputed, void, or burned per §3.5)
3. If a cached Keepsake Copy / Share Copy for this (deed, owner) pair exists, serve it. Otherwise build on demand by decrypting the Original from server-side custody (decrypt `DEK_image` from `platform_DEK`), resizing, composing monogram + metadata + URL text (Share Copy always present; Keepsake Copy present by default, suppressed only when the creator enabled owner-discretionary URL placement and the owner chose to suppress at Card 6), and caching the result before serving
4. Serving the cached owner variants does NOT transition deed state (the Keepsake Copy / Share Copy is intended for repeated display)

**Deed-Holder Master Download (Cryptographically Mediated Seal-Break).**

When the authenticated deed holder requests the full-resolution Master, access is platform-mediated by cryptographic necessity. The owner does not hold any encrypted form of `DEK_image`; only the platform can decrypt from `platform_DEK`:

1. Verify on-chain ownership and deed state (as above) via owner's wallet signature on a freshly issued challenge
2. Decrypt the Original from server-side custody (decrypt `DEK_image` from `platform_DEK`, decrypt encrypted Original bytes)
3. Compose variant `M+N` (owner ordinal = N) and record `{M+N: sha256(M+N_pixels)}` to deed metadata via mint-authority Solana transaction
4. Transition the image from sealed to opened on the same Solana transaction; this is recorded as `deed_state` per §3.5 and permanently disables resale
5. Deliver the Master to the deed holder

The seal-break mutation is cryptographically enforced. There is no offline path for the owner to access the Master during operational life; every Master access goes through the platform-mediated flow and produces an on-chain audit record. The owner's wallet signature authenticates the request but does not grant cryptographic capability over `DEK_image`.

**Public Render.**

Public viewers access the resized derivative via the access-control renderer (§7.3 Layer 3):

1. Renderer fetches the Cloudinary-transformed render at display resolution from the cached public variant (Share Copy post-personalization; Listing preview pre-sale)
2. Renderer delivers the composition through canvas / WebGL with anti-save measures
3. The Original is never decrypted in the public-render path -- the cached variant suffices

The public render is the default surface for the Share Copy variant, the Open Graph card, the image-page preview, and discovery surfaces. The deed-holder Master download is rare (mutates deed state); the public render serves the bulk of platform traffic.

**Post-Cessation Per-Owner Recovery.**

If the platform discontinues operations, the trustee publishes `platform_DEK`. Recovery is then permissionless to start but per-owner in outcome:

1. Retrieve `platform_DEK` plaintext from the trustee's publication channel
2. Read `enc_final` from the deed's on-chain metadata via any Solana RPC
3. Decrypt the outer layer of `enc_final` using `platform_DEK` to expose the inner `encrypt(DEK_image, owner_wallet_pubkey)`
4. The deed's current owner (per on-chain `owner` field at cessation, or a post-cessation transfer if the deed was moved before cessation) decrypts the inner layer using their wallet private key to recover `DEK_image`
5. Retrieve the encrypted Master bytes from the Arweave URI in the deed metadata
6. Decrypt the Master bytes using `DEK_image`

The recovered Master is the license-survival guarantee in §3.4 CMA. The mechanism is per-owner trustless: steps 1-3 and 5 are permissionless (anyone can perform them on any deed), but step 4 is gated by the current owner's wallet key. A non-owner who completes steps 1-3 obtains only the inner ciphertext, which they cannot decrypt without the wallet private key. Each deed's Master is therefore accessible post-cessation only to its current owner, preserving ownership exclusivity past platform shutdown.

The bytes do not become universally public at cessation. Owners who lose their wallet keys before cessation cannot recover their deed's Master; this is the explicit self-custody trade-off acknowledged in the BMA wallet-custody clause (R67 §6.11).

**Master-Download Scenarios and Deed-State Effects.**

| Scenario | Source | Effect on deed state |
|---|---|---|
| Deed-holder Master download via platform (§7.5 Deed-Holder Master Download) | Server-side Original via `platform_DEK` decrypt of `DEK_image` | sealed -> opened (cryptographically enforced) |
| Commerce one-click print fulfillment (server-side; no deed-holder download) | Server-side Original | No state change |
| Post-cessation per-owner recovery | Arweave Master + published `platform_DEK` + current owner's wallet key | No state change (deed records frozen at cessation) |

**Suspension on Takedown.**

When the deed transitions to rights-disputed, void, or burned (per §3.5), both the deed-holder delivery paths and the public render are suspended. The access-control renderer refuses to serve any rendering, the image-page is suppressed, the Open Graph card is suppressed, and the discovery index removes the listing. Cloudinary transformations are deleted as part of the suspension cleanup. The server-side Original is retained under platform custody during the dispute window (in case the dispute resolves to `sealed` and the deed is restored) and is purged on transition to `burned`.

Post-cessation per-owner recovery is unaffected by takedown state because the publication releases `platform_DEK` rather than per-deed decryption material; the inner wallet layer remains owner-bound. Contractual constraint applies via the BMA takedown-notice clause documented in §4.9.4.

### 7.6 URL-Text Rendering Contract

The URL text is an in-pixel layer (§2.2), always present on the Share Copy (non-removable) and present by default on the Keepsake Copy (suppressible by the owner only when the creator enabled owner-discretionary URL placement at upload). The contract below is calibrated for the Share Copy (1080px, social-media recompression); a Keepsake Copy that carries the URL sizes its cap-height by the §2.2 Keepsake Copy logic (fixed physical height at 300 DPI) rather than the Share Copy fraction, while the orientation, font, weight, tracking, and contrast rules apply unchanged. Placement and costly-signal rationale are specified in R67 §5.9 and Appendix I. This section specifies the rendering contract that keeps the URL text machine-readable after the Share Copy enters social-media circulation.

**Dual-audience requirement.** The URL text serves two readers. The primary path is optical character recognition -- iOS Live Text and Google Lens detect the text on long-tap and route the viewer to the image page; the human-readable fallback is manual entry or verbal sharing. The OCR path is load-bearing: if detection fails, the routing loop documented in R67 §5.9 breaks. The contract therefore optimizes for machine readability without sacrificing the fine-art-print register that motivated URL text over a scannable code (R67 Appendix I). The URL is also a visible authenticity signal: unlike the §2.2 monogram, which is recessive, the URL is rendered at full opacity and sized toward the upper end of the cap-height range, because a verification mark that recedes does not signal.

**Degradation model.** The Share Copy is rendered at the social platform's native feed resolution (1080px wide; Instagram downscales anything wider [instagram-nodate], so the Share Copy is not oversized) and the URL text is composed onto the variant after resizing, so the text leaves the platform crisp. The degradation it must survive is the platform's re-encoding: every uploaded image is recompressed [instagram-nodate], and on re-shares, screenshots, and non-Instagram surfaces a downscale pass compounds with the recompression. The contract is calibrated to survive recompression at 1080px; survivability is confirmed empirically, not assumed.

**Rendering contract.**

| Parameter | Specification |
|---|---|
| Orientation | Text rotated 90° as a unit along the lower-right edge. Rotated text is OCR-readable with a measurable confidence penalty; stacked-upright Latin characters are not OCR-readable and are prohibited |
| Placement | Lower-right, inset roughly 40-50px from the right edge so the strip survives the Instagram profile-grid side-crop intact rather than appearing as a clipped sliver |
| Font | A monospace coding-grade typeface whose character disambiguation is present in its defaults, because the Cloudinary text overlay cannot reliably toggle OpenType stylistic sets. IBM Plex Mono is the reference choice -> default slashed zero, default distinct `1` / `l`. Proportional UI typefaces (Inter, Roboto) are excluded: their disambiguating glyphs are gated behind OpenType features the renderer cannot reach |
| Weight | Medium to Semi-Bold. Below this band, thin strokes (the slashed-zero diagonal, the foot of the `l`) are erased by recompression; above it, glyph counters choke shut |
| Tracking | Generous letter-spacing, tuned to the rendered pixel size, preserving clean per-character bounding boxes through recompression |
| Contrast | Fixed light fill plus a fixed ~2px dark stroke. The fixed bi-tonal pair carries both contrast tones inside the glyph, keeping the text readable over any background luminance without per-region analysis. Rejected alternatives: `predominant_contrast` (a single image-wide color, no within-strip adaptation), difference / exclusion blend (requires a live render layer absent from the flattened Share Copy, and shifts hue over saturated color), soft drop shadow (blurred edges degrade OCR binarization), and an opaque backplate (reintroduces the tech-artifact register rejected in R67 Appendix I) |
| Cap-height | A pinned minimum -> a fraction of the Share Copy's final width with an absolute pixel floor: roughly 3-4% of the 1080px Share Copy width (about 32-43px cap-height), hard floor near 30px. This is deliberately larger than the §2.2 Share Copy monogram, because rotation and machine reading remove the tolerance a human careful-look has -- OCR has no zoom-and-squint fallback, and the base-36 slug carries no linguistic context for error-correction. Set generously because rotation consumes reliability headroom and 1080px is a small canvas. This is the load-bearing parameter; the others are ineffective below it |

**Renderer.** The URL text is composed with the Cloudinary `l_text` overlay -> fixed `co_` fill, fixed `bo_` stroke, rotation angle, and tracking [cloudinary-nodate]. No additional library is required.

**Validation.** The contract is verified empirically: a rendered Share Copy is passed through real social-platform recompression (Instagram and X at minimum) and the rotated strip is OCR-tested with both iOS Live Text and Google Lens. A failed test promotes a larger cap-height before any other adjustment; horizontal placement along the bottom edge is the fallback if rotation cannot be made reliable.

**Slug-alphabet note.** Residual character collisions in the base-36 lowercase image-ID slug -- digit `1` versus lowercase `i`, and the adjacency illusions `rn` / `m` and `vv` / `w` -- are an image-ID encoding concern (§2.3, Appendix D), not a rendering one, and are not addressed by this contract.

---

## 8. CONCLUSIONS

The Decentralized Master Licensing Protocol resolves the digital ownership problem at the heart of the NFT collapse by merging the music industry's master/copy distinction with cryptographic creator authentication. Encrypted Master Images in Arweave custody, NFT deeds with creator-defined exclusive licenses, and a glass-box gallery architecture together convert digital ownership from symbolic to functional.

The protocol's legal architecture is integrated rather than appended. Master Image transactions are demonstrably outside Howey (R67 §5.7), the deed-license-content tethering satisfies the Moringiello-Odinet property-tokenization framework (R67 Appendix A.1), and copyright, DMCA, ESIGN, and FTC franchise compliance are technical product requirements rather than retrofitted disclaimers.

Market sizing, competitive positioning, and product-market fit analysis are documented in R66. The Digital State Museum (Appendix A) extends the protocol into a premium tier for fine art creators sharing core infrastructure at higher price points.

---

## 9. REFERENCES

**Cross-Document Dependencies:**
- **R24:** YouTube Creator Market Analysis -> addressable creator population, 100K+ subscriber tier
- **R35:** DAO Web2 Abstraction -> Stripe Connect payment splitting, Money Transmitter Business compliance, KYB requirements, token price visibility restrictions, embedded wallet services
- **R36:** DAO Donation Mechanisms -> donation infrastructure referenced in collaborator framework
- **R42:** Money Transfer Compliance Analysis -> compliance cluster reference
- **R58:** Crypto Regulation Compliance -> legal cluster reference, UCC Article 12 enactment context
- **R65:** Gallery Platform Security -> threat model and countermeasures (referenced from §4.7 in place of inline countermeasure table)
- **R66:** Gallery PMF -> market sizing, audience targeting, competitive positioning, product-market fit analysis
- **R67:** Gallery Design -> behavioral foundations (Pierce-Kostova-Dirks, Hagtvedt-Patrick, Atasoy-Morewedge, Spence), historical-failure record, consolidated design rationale, and `image_spec` rationale (§5.14) backing the §2.3 schema

**External References:**
All external sources cataloged in **Reference.md**.

---

## APPENDIX A: GALLERY MUSEUM (PREMIUM TIER)

This appendix defines the Gallery Museum, a premium tier of the Decentralized Master Licensing Protocol designed for fine art creators whose work requires museum-grade digitization, institutional custody, physical reproduction pipelines, and advanced originality protection. The core protocol (Sections 1-8) serves mass-market creators with the Studio extension for upload and cleanup (Section 6.1), content uniqueness enforcement (Section 6.2), and Sole Copy Agreement (Section 6.3). The Museum extends that infrastructure to the high-end art market, introducing elevated quality standards (FADGI 4-Star), a physical-digital primacy inversion that transforms the NFT from a collectible into a production right, a four-layer glass-box display architecture, external platform monitoring and operator escalation for originality enforcement (Section A.8), and Elanoid-operated institutional custody.

Both tiers share the same underlying infrastructure: Solana NFT minting, Arweave encrypted custody, Stripe Connect payment processing, digital passport identity verification, and the Digital Gallery for discovery and transactions. The Museum adds institutional layers on top of this shared foundation.

### A.1 Relationship to Core Protocol

| Dimension | Core Protocol (Sections 1-8) | Museum Premium Tier (This Appendix) |
|---|---|---|
| Target creator | YouTubers, digital artists, illustrators, all content categories | Fine artists, painters, photographers, high-end digital artists |
| Quality standard | Consumer-grade (4000px, 8-bit, sRGB, smartphone camera) | FADGI 4-Star (300+ PPI, 16-bit, Adobe RGB, Cruse/Metis scanner) |
| Ingestion | Creator uploads through Web2 interface | Physical: scan shop digitization + mandatory alteration. Digital: Sole Copy Agreement |
| Physical output | Not in core; optional via Section 5 (Reproduction and Distribution) | Core feature: archival Giclee prints, 3D textured UV printing |
| Display architecture | Four-layer glass-box (Section 4.4) with gallery metadata | Four-layer glass-box (Section 4.4) with museum-grade institutional framing, museum authentication seal |
| Originality protection | Quality gate + encrypted custody + provenance metadata | Three-layer stack: economic alignment + AI enforcement (near-duplicate match + semantic similarity) + graduated consequences |
| Legal structure | Exclusive License bundled with NFT deed | Museum Deed Agreement + Museum Submission Agreement + Scan Shop MSA |
| Governance | Operator-run by Elanoid | Operator-run premium tier; museum policy set by Elanoid |
| Portals | Mobile app + web app + social embeds (Section 4.6) | Museum extensions to gallery portals: museum authentication, physical reproduction ordering, FADGI certificates |
| Expected price range | $500-$50,000 per Master | $10,000-$500,000+ per Master |
| Asset class | Digital collectible with personal use + resale | Production right: singular authenticated digital source for archival physical manufacturing |

### A.2 The Gallery Museum as Institution

The Gallery Museum is the platform's premium institution: a cultural venue that displays, attributes, and verifies owner-held artifacts. Unlike existing digital museums, which display digital copies of physical originals, it holds only digital originals -- every artifact exists primarily as a museum-grade digital master, with no unaltered physical original surviving outside its custody.

This resolves the NFT tethering problem through institutional design: the deed is tethered not to a raw Arweave file but to a cultural institution that guarantees display, attribution, and provenance verification as a custodial service. Owners prove holdings through their Gallery account (§4.10); the Museum then renders the artwork with full creator attribution, owner identity, and provenance history, requiring no wallet connection or blockchain literacy at display time.

### A.3 Museum-Grade Quality Standards

Museum artwork must meet or exceed FADGI 4-Star / Metamorfoze Strict compliance thresholds.

| Category | Specification | Tolerance |
|---|---|---|
| Resolution | Minimum 300 PPI at reproduction size | 600+ PPI preferred for large-format originals |
| Bit Depth | 16-bit per channel (48-bit RGB) | 8-bit acceptable only for final derivatives, never the master |
| Color Space | Adobe RGB (1998) or ProPhoto RGB | sRGB too narrow for fine art gamut |
| File Format | Uncompressed TIFF (.tif) | No lossy compression at master stage |
| Color Accuracy | Delta E (CIE76) average < 2.0 | Measured against calibrated reference target |
| Tone Response | OECF deviation < 2% from linear reference | Per ISO 14524 / FADGI guidelines |
| Noise Floor | Signal-to-noise ratio > 40 dB in shadow regions | Ensures shadow detail is genuine, not noise |
| White Balance | Captured under 5000K or 5500K (D50/D55) | Consistent with museum and conservation lighting |
| Geometric Distortion | < 0.5% barrel/pincushion | Measured via grid target |
| File Size (Typical) | 200 MB to 2 GB per master | Dependent on dimensions and scanning resolution |

**Hardware Standards.** Contact-free scanning (Cruse or Metis) is the gold standard. These systems use a synchronized light and sensor array that moves across the painting, ensuring zero lens distortion and perfectly even lighting. If using a camera, a medium format system (Phase One or Hasselblad) with 100MP+ resolution is required. Lighting must be 5000K or 5500K balanced LED or strobe with CRI 98+. Cross-polarization is mandatory for oil paint and varnish.

**Metadata Requirements.** Museum-grade files include embedded XMP/IPTC metadata covering technical data (scanner model, lens, lighting, ICC profile), descriptive data (artist name, original dimensions, medium, capture date), and provenance data (digitization studio, technician name).

### A.4 Artwork Ingestion Protocol

The Museum's value proposition depends on a guarantee: the digital master is the authentic original, and no unaltered physical original exists. Without this guarantee, the physical-digital inversion collapses.

**Physical Artwork Ingestion.** When a creator submits a hand-painted or physically produced artwork:

1. **Proof of Authorship.** The creator produces a proof-of-work video documenting artwork creation from identifiable stages through completion. The video is stored as a permanent provenance artifact.
2. **Scan Shop Digitization.** The creator ships the physical piece to a Gallery-affiliated scan shop operating under a Master Service Agreement (MSA). The scan shop performs FADGI 4-Star capture (300+ PPI, 16-bit, calibrated ICC profiles, uncompressed TIFF). Quality control checks verify compliance. The authenticated master file transmits to Arweave encrypted storage.
3. **Mandatory Alteration.** After digitization, the physical painting returns to the creator for mandatory modification. The creator must resize the canvas (cropping, extending, or reformatting) and add new visual features (additional brushwork, compositional changes, color modifications). The alterations must be sufficient that a side-by-side comparison reveals clear, intentional differences. The creator documents the alteration process.
4. **Shipment to Owner.** The altered physical painting ships to the NFT owner. The owner receives a unique artist-altered physical piece with a compelling provenance story: an artist-altered painting that was once the original, documented at every stage. The digital master in the Museum is the only record of the artwork in its original unaltered state.

**Digital-Native Artwork Ingestion.** When a creator submits digital-native artwork (created entirely in digital tools), the Museum applies the core platform's Sole Copy Agreement (Section 6.3) with elevated enforcement. The core platform's Studio extension handles automated file cleanup, and the Sole Copy Agreement provides contractual coverage. The Museum adds the following premium-tier obligations:

1. The Museum holds exclusive custody of the master file from the date of execution forward.
2. Breach constitutes violation of museum membership terms, triggering artwork removal, NFT invalidation, and potential legal action (beyond the core platform's graduated penalties).

The Sole Copy Agreement is a legal instrument, not a technical enforcement mechanism. Digital file deletion cannot be technically verified. The agreement addresses this through contractual obligation and reputational consequence, supplemented by the Studio extension's automated cleanup (Section 6.1), the core platform's content uniqueness enforcement (Section 6.2), and the Museum's originality protection extensions (Section A.8).

| Dimension | Physical Artwork | Digital-Native Artwork |
|---|---|---|
| Proof of authorship | Proof-of-work video | File metadata and creator attestation |
| Digitization | Affiliated scan shop (MSA) | Creator uploads master file directly |
| Quality standard | FADGI 4-Star (scan shop enforced) | FADGI 4-Star equivalent (platform verified) |
| Singularity mechanism | Mandatory alteration (physical becomes derivative) | Sole Copy Agreement (contractual) |
| Verification strength | High (alteration is visually verifiable) | Moderate (relies on contractual compliance) |
| Creator retains | Nothing; altered piece ships to owner | Nothing; all copies deleted per agreement |
| Owner receives | Artist-altered physical derivative | Production rights via museum pipeline |

### A.5 The Physical-Digital Primacy Inversion

The ingestion protocol inverts the historical relationship between physical and digital art. In the traditional hierarchy the physical original is primary and the digital reproduction derivative -- a painting exists first on canvas, the scan afterward, value flowing from physical to digital. The Museum reverses this: the digital master exists first, or becomes the sole surviving original through the ingestion protocol, and physical reproductions are manufactured from it through the archival production pipeline.

**The NFT as Production Right.** This reframes the NFT from collectible to production right: the exclusive authority to manufacture museum-grade physical art from an authenticated digital master, with provenance embedded in every copy. The closest physical-world analogy is owning a printing plate or a film negative -- a singular source object from which authorized reproductions are produced. It answers the "you own a JPEG" criticism directly: the deed grants access to a pipeline that converts digital ownership into archival physical prints rated for 100+ years and indistinguishable from a physical painting at gallery viewing distance. The physical painting exists in one place at one time; the digital master is singular and immutable yet can manifest physically in unlimited locations.

**Reversal of the "Right-Click Save" Argument.** A screenshot is compressed, resolution-limited, stripped of color-profile metadata, and disconnected from the authenticated master and production pipeline. It cannot enter the archival printing workflow because it fails every technical threshold -- resolution, bit depth, color calibration, provenance metadata. The gap between a screenshot and the authenticated master is categorical, equivalent to the gap between a phone photograph and a Cruse scanner capture.

**Creator Perpetual Royalty Stream.** Every physical replica sold through the Museum's production pipeline generates creator royalties (5-10%, per Doc 15, Section 1.3). The creator's digital artwork becomes a source of perpetual physical-world revenue -- royalties on every physical manifestation produced from a digital master, which no existing gallery system offers.

### A.6 Four-Layer Glass-Box Display Architecture

The Museum inherits the four-layer glass-box display architecture defined in Section 4.4 (structural, intentional, categorical, and deliberate glass layers, owner's private view, and anti-save measures). Museum-specific extensions:

- **Layer 1 (Structural Glass):** FADGI 4-Star minimums replace standard core-protocol minimums, ensuring fine art resolution standards.
- **Layer 3 (Categorical Glass):** Institutional framing includes a museum authentication seal, museum exhibition branding, and mandatory alteration provenance chain for digitally-native works.
- **Layer 4 (Deliberate Glass):** Museum artwork standards exceed core gallery minimums, placing museum pieces in a distinct asset class above standard Master Images.

### A.7 Museum Portals

The Museum inherits the gallery portal architecture defined in Section 4.6 (mobile app, web app, social embeds, webpage widget). Museum-specific extensions:

- **Mobile App:** Museum-grade rendering with museum authentication seals, commissioning archival physical reproductions (Section A.11), viewing FADGI 4-Star quality certificates, and accessing Sole Copy Agreement provenance for each artwork.
- **Web App:** Dedicated museum exhibition spaces, curated shows, a physical reproduction ordering interface, and an administrative surface for operator decisions on museum quality standards.

### A.8 Museum Originality Protection Extensions

The core platform's content uniqueness enforcement (Section 6.2) provides the baseline: two-tier algorithmic detection (near-duplicate match + semantic similarity) blocks duplicate or near-identical Master Images at ingestion. The Studio extension (Section 6.1) handles automated file cleanup, and the Sole Copy Agreement (Section 6.3) provides contractual coverage. The Museum extends this baseline with three additional protections specific to the premium fine art context.

**Extension 1: Economic Alignment (Self-Enforcing).** The creator earns royalties on every physical reproduction and secondary transfer. Creating a competing replica outside the Museum cannibalizes the creator's own revenue stream. If the owner commissions 50 archival prints per year, the creator receives 5-10% of each sale in perpetuity. Producing a competing version destroys this revenue, devalues the museum-held original, and reduces secondary market price.

**Extension 2: External Platform Monitoring.** The Museum extends the core platform's ingestion-time detection to continuous external monitoring. A scheduled scanning service crawls major digital art platforms (ArtStation, DeviantArt, Saatchi Art, Etsy, social media) and matches newly published works by museum-registered creators against the near-duplicate and semantic-similarity indexes. Any work exceeding a calibrated similarity threshold triggers an automated flag, initiating notification to the creator, a 14-day response period, and if insufficient differentiation is demonstrated, escalation to operator review. Per-creator threshold calibration accounts for the fact that a photorealist painter's distinct works may have higher baseline similarity than an abstract expressionist's.

**Extension 3: Operator Escalation.** Confirmed violations trigger graduated penalties administered by Elanoid as platform operator. First offense: formal warning, temporary royalty suspension, mandatory removal of the flagged replica. Second offense: permanent royalty suspension on the affected artwork, submission privileges frozen for 12 months, public notation on the creator's museum profile. Third offense: permanent expulsion from the museum, termination of all agreements, and forfeiture of all accrued royalty streams.

**Combined Deterrence.** No single layer is complete; economic self-interest, external algorithmic monitoring, and institutional consequences compound on top of the core platform's ingestion-time blocking (§6.2) to create a deterrent comparable to the music industry's protection of master recordings.

### A.9 Museum Legal Ownership and Contractual Framework

The Gallery Museum is operated by Elanoid as the premium tier of the Gallery platform. Museum quality standards, ingestion requirements, and production pipeline specifications are set and maintained by Elanoid as platform operator.

**Elanoid to Creator: Museum Submission Agreement.** Governs artwork ingestion. For physical submissions: proof-of-work video, scan shop digitization, mandatory alteration, and shipment to NFT owner. For digital submissions: Sole Copy Agreement. Both types include: museum display rights, creator royalty terms (5-10% on physical replica sales and secondary transfers, creator-set within governance bounds), attribution requirements, and breach remedies.

**Elanoid to Scan Shop: Master Service Agreement (MSA).** Governs digitization quality (FADGI 4-Star), chain-of-custody procedures, confidentiality (no file retention after transmission), and annual recertification.

**Elanoid to NFT Owner: Museum Deed Agreement.** Owner rights: exclusive full-resolution viewing, visibility control (public/private toggle), physical replica commissioning through archival pipeline, physical replica sales, and full transfer on resale. Owner obligations: maintain a valid digital passport, comply with museum display policies, and acknowledge Elanoid custody of the master file. Deed terminates if the NFT is invalidated; owner retains physical replicas already produced.

| Agreement | Parties | Governs | Key Obligation |
|---|---|---|---|
| Museum Submission Agreement | Elanoid to Creator | Artwork ingestion and creator rights | Creator warrants originality; accepts alteration or sole copy terms |
| Scan Shop MSA | Elanoid to Scan Shop | Digitization services | FADGI 4-Star quality; chain-of-custody; no file retention |
| Museum Deed Agreement | Elanoid to NFT Owner | Ownership rights and production access | Owner holds deed; Elanoid holds master file; production pipeline access |

### A.10 IP Rights Allocation

The Museum resolves the ambiguity that plagued 80% of NFT purchases through an explicit rights framework modeled on the music industry's master/composition split.

| Right | Creator | NFT Owner | Museum (Elanoid) |
|---|---|---|---|
| Copyright (composition) | Retained | Not transferred | Not held |
| Moral rights (attribution, integrity) | Retained; enforced by museum | N/A | Enforcer |
| Master possession (sole digital original) | Transferred at ingestion | Held via deed | Custodian |
| Physical reproduction (archival pipeline) | Royalty recipient (5-10%) | Exclusive right | Pipeline operator |
| Display through portals | Attribution guaranteed | Controls visibility | Infrastructure provider |
| Commercial licensing (merch, brand deals) | Retained; independent negotiation | Not transferred | Not involved |
| Derivative works (adaptations, remixes) | Retained; requires separate agreement | Not transferred unless negotiated | Not involved |
| Secondary sale | Royalty recipient (smart contract) | Full transfer of all owner rights | Facilitates passport verification |
| New original works (same style/series) | Unrestricted | N/A | N/A |
| Substantially similar reproduction | Prohibited (Sole Copy Agreement, Section 6.3) | N/A | Core platform detection (Section 6.2) + Museum extensions (Section A.8) |

### A.11 Physical Reproduction Pipeline

The Museum partners with certified fine art printing services to produce archival-quality physical reproductions from authenticated digital masters.

**Print Specifications:**

| Specification | Requirement |
|---|---|
| Printer type | 10-12 color pigment-based inkjet (Giclee), UV-stable, rated 100+ years |
| Media | Acid-free, lignin-free, 100% cotton rag or alpha-cellulose paper (Hahnemuhle, Canson Infinity, Awagami) |
| Optical brighteners | OBA-free preferred (maintains base white indefinitely) |
| Proofing | Hard proof (1:1 scale strip) viewed under D50 lighting before final run |
| Advanced option | 3D textured UV printing (SwissQ) builds physical paint texture through multiple clear/white ink passes |

**Perceptual Quality by Viewing Distance:**

| Viewing Distance | Impression |
|---|---|
| > 5 Feet | 100% indistinguishable from the original |
| 3 Feet (Gallery distance) | Colors and detail perfect; "presence" maintained |
| < 6 Inches | Viewer may notice uniform surface sheen and lack of physical paint volume |

**Estimated Costing (24" x 36" reference):**

| Service Tier | Components | Estimated Cost |
|---|---|---|
| Professional | Standard scan + 1 proof + Giclee print | $190 to $240 |
| Museum Archive | Cruse scan + color match + premium Giclee | $350 to $450+ |
| Tactile Reproduction | Cruse scan + 3D UV textured (SwissQ) | $650 to $950+ |

Every physical print carries embedded provenance: certificate of authenticity referencing the on-chain NFT, the creator's digital signature, the owner's identity, and a printed URL text linking to the Museum's provenance record. Creator royalties are automatically deducted from each replica sale.

### A.12 New Asset Class Definition

The combination of authenticated digital master, exclusive production rights, archival physical output, perpetual creator royalties, and on-chain provenance constitutes an asset class that does not map to existing categories. It is not a digital collectible (it produces physical objects). It is not a physical artwork (the source is digital). It is not a license (the owner holds the deed, not a revocable permission). It is not a financial instrument (value derives from aesthetic and production utility, not expected returns from others' efforts). The Museum creates a hybrid asset: a singular authenticated digital source that functions as both a collectible and a production origin, with institutional infrastructure ensuring physical output meets standards historically reserved for museum conservation departments.

---

## APPENDIX B: TECHNICAL THESIS - DECENTRALIZED DEED REGISTRY WITH DRM

This appendix consolidates the technical thesis underlying Gallery's product architecture into a single concentrated argument suitable for technical due diligence and investor diligence. It complements the protocol specifications in §2-§7 by stating the architectural contribution at the thesis level.

### B.1 Architectural Characterization

Gallery is a decentralized deed registry structurally fused with digital rights management. The two components operate in coupled feedback: ownership transfer triggers re-encryption of the protected artifact's access key to the new owner's wallet, and access enforcement is anchored to deed-holder status rather than to platform account state. Neither component is a new invention in isolation; the structural fusion is the architectural contribution that this protocol specifies and the patent portfolio defends.

### B.2 Why the Fusion Is Synergic

Each component fails alone. Only the combination delivers the digital-image-ownership thesis.

| Configuration | Failure mode | Empirical evidence |
|---|---|---|
| Deed registry alone | Access uncoupled from ownership; anyone can access the artifact regardless of who holds the deed; scarcity collapses | 2021-2024 NFT cohort, $40B+ cumulative volume, 96% of collections dead by 2024 (R67 §3.2; R66 §4.5) |
| DRM alone | Access is gated but ungovernable by the user; no transferable position, no provenance, no resale; produces rental-grade access | Subscription platforms (Patreon, YouTube Memberships, Adobe Creative Cloud) -- large markets but no ownership economics |
| Loosely coupled (deed plus DRM, no transfer-triggered re-encryption) | Prior owner retains access after sale; scarcity collapses in resale even if it held in primary sale | Most "NFT with off-chain content" implementations |
| Structurally fused (transfer triggers re-encryption) | Access follows ownership cryptographically; scarcity holds through resale; license survives platform shutdown | Gallery |

The synergy is bidirectional. The deed registry needs DRM to enforce that ownership records correspond to actual access control; without DRM, the deed records ownership of something anyone can take freely. DRM needs the deed registry to make access control transferable, ownable, and provenance-bearing; without the deed, DRM produces platform-locked access that ends when the user's account ends.

### B.3 Legal Foundation as Missing Infrastructure

The architecture operationalizes 17 U.S.C. §202's distinction between copyright ownership and object ownership. Copyright remains with the creator; the sale conveys object ownership of the authenticated digital instance plus a license defining permitted uses, recorded by the deed with pointers to the encrypted artifact, the license terms, and the provenance chain. Copyright law contemplates this structure but provides no verification infrastructure for digital artifacts. Gallery is the missing infrastructure layer -- a public registry that distinguishes legitimate ownership claims from false ones, with cryptographic anchoring replacing the institutional gatekeepers that physical-property registries depend on.

### B.4 Self-Service Cost Structure

Gallery replaces every human intermediary in standard deed-registration with cryptographic verification and automated execution.

| Function | Real-property registry | Gallery |
|---|---|---|
| Identity verification | Notary, in-person | Three-layer authentication chain |
| Title recording | County recorder, manual filing | Smart contract, automated mint |
| Transfer execution | Title company plus escrow | Smart contract, atomic settlement |
| Provenance lookup | Public records search, often paid | On-chain query, free, instant |
| Settlement time | Days to weeks | Seconds |
| Per-transaction cost | $500 to $3,000+ | Cents in protocol fees plus platform margin |
| Hours and jurisdiction | Business hours, local | 24/7, internet-native |

The cost structure inversion is what makes the platform thesis work for low-value high-frequency assets (digital images at tens to hundreds of dollars, transacting via primary sale, gifting, resale, format renderings) where human-mediated registries are economically non-viable.

### B.5 Patent Defense at Genus Level

The structurally fused architecture is defended by six independent claims (P21 §6.1-§6.6) plus combination claims A+B, A+C, and A+B+C (P21 §6.7). Three properties of the patent drafting matter for the thesis:

1. **Genus-level claim scope.** Independent claims cover any image transformation method (Claim B), any uniqueness evaluation algorithm (Claim F), and any verification-method anchor for the authentication chain (Claim C). Competitors cannot design around by substituting one transformation method, one algorithm, or one identity-verification mechanism for another.

2. **Verification-method neutrality.** The authentication chain in Claim C is drafted at the architectural-pattern level. Substituting platform OAuth for government ID, institutional registry, biometric verification, or estate documentation does not exit the claim's scope. This is what makes the architecture extensible to photography, fine art, archives, museum collections, and journalistic provenance with adapted authentication anchors. The wedge-and-platform application of this property is documented in R66 §6.1.

3. **Combination claim resilience.** A+B+C as an independent claim captures the resolver's complete functional scope (accessibility, authentication, authorization). An infringer must design around all three functional dimensions simultaneously, and an examiner challenging any single claim leaves the combination claims intact.

The patent's narrowness is on asset-type (digital images, not video/audio/text). Asset-type extensions require additional independent claims, supported by appropriate written description in non-provisional specifications. The verification-method dimension is structurally broad.


## APPENDIX C: CONTENT MODERATION TECHNOLOGY MATURITY ANALYSIS

This appendix documents the production-grade maturity timeline of the content moderation, content grading, and content authenticity technologies that R62 §6.4-6.9 invoke. The analysis supports R66 §1.2 buyer-decision attributes (Content safety, Content grading) by establishing that the platform's content gates rest on commodity infrastructure rather than research-stage technology.

### C.1 Maturity Timeline by Technology Category

| Technology category | Production-grade since | Vendors / standards | Use in Gallery |
|---|---|---|---|
| Perceptual hash matching (PhotoDNA) | 2009 (Microsoft + Dartmouth; deployed at NCMEC) | PhotoDNA, MD5, PDQ, CSAI Match | §6.6 Tier 0 (CSAM hash matching) |
| Generic NSFW classifiers (cloud APIs) | 2017-2018 | Google Cloud Vision SafeSearch, AWS Rekognition Content Moderation, Microsoft Content Safety | §6.6 Tier 3 (adult-content classification) |
| Specialized content moderation classifiers | 2020 (Hive Moderation general release; ensemble approach in production) | Hive Moderation, AWS Rekognition, Google Vision | §6.6 Tier 3 (adult, violence, hate, drugs) |
| Synthetic CSAM detection | 2018-2019 (known-CSAM); 2023-2024 (AI-generated CSAM) | Thorn Safer | §6.6 Tier 0+ (synthetic CSAM) |
| AI-image generation detectors (diffusion-artifact, GAN-fingerprint, model-specific signature) | 2022-2024 (production-grade) | Sensity-class APIs, Hive AI-image detector, self-hosted alternatives | §6.4 Tier 2 (generative-model fingerprints) |
| NCII detection (separate from generic NSFW) | 2024 (dedicated classifiers); PhotoDNA NCII expansion 2024 | PhotoDNA NCII, Hive NCII classifier | §6.6 Tier 2 |
| Aesthetic-quality scoring | NIMA 2018 (Google Research); LAION-Aesthetic 2022; production APIs 2023-2024 | NIMA, BRISQUE, LAION-Aesthetic predictor, commercial equivalents | §6.9 (assistive scoring) |
| CLIP / vision-language models (subject coherence) | 2021 (OpenAI release) | OpenAI CLIP, open-source successors | §6.9 (subject-coherence detection) |
| Format-conformance parsers (strict-mode) | 2010s (mature) | libpng, libjpeg-turbo | §6.8 Malware Detection Gate (format validation) |
| Polyglot / steganography detection | 2018+ (statistical steganalysis); AV signature scanning mature | ClamAV, commercial AV engines | §6.8 Malware Detection Gate (embedded-payload scanning) |
| Identity verification / KYC | 2010s (mature) | Persona, Stripe Identity, Onfido, Jumio | §3.1 Authentication and Ownership Procedure (creator OAuth + biometric proof) |
| Face-embedding similarity (public-figure index) | 2010s (mature; biometric-data regulations BIPA / SB-1001 govern usage) | Self-hosted face-embedding models, regulated commercial equivalents | §6.5 Right-of-Publicity Gate (deepfake-of-real-person detection) |

### C.2 Maturity Summary by Gate

| Gate | Earliest constituent technology | Latest constituent technology | Net maturity |
|---|---|---|---|
| §6.4 Content Authenticity | Identity verification (2010s) | AI-generation detection (2024) | Mature; AI-detection layer is youngest |
| §6.5 Right-of-Publicity | Face-embedding (2010s) | Synthetic-likeness detection (2023-2024) | Mature; synthetic-likeness layer is youngest |
| §6.6 Content Moderation | PhotoDNA (2009) | Synthetic CSAM detection (2024); NCII classifier (2024) | Mature; NCII and synthetic-CSAM layers are youngest |
| §6.7 Provenance and Rights | DMCA infrastructure (1998+) | Cross-jurisdiction rights resolution (mature) | Mature |
| §6.8 Malware Detection | Format parsers (2010s); ClamAV (2010s) | Steganalysis (2018+) | Mature |
| §6.9 Content Grading | NIMA (2018) | LAION-Aesthetic + CLIP (2021-2022) | Production-grade; some classifiers research-recent |

### C.3 Implications for Platform Risk

| Risk dimension | Status | Note |
|---|---|---|
| Vendor lock-in | Low | Multiple vendors per detection category; self-hosted alternatives exist for all critical paths |
| Cost predictability | Good | Per-image inference pricing published by all major vendors; volume tiers standard |
| Technology risk for established categories (CSAM, NSFW, violence) | Low | Mature 5-15 years; deployed at internet scale across all major UGC platforms |
| Technology risk for AI-generation detection | Moderate | Production-grade but rapidly evolving as new generative models appear; mitigated by ensemble approach and post-ingestion re-runs (§6.6 false-negative containment) |
| Regulatory alignment | Strong | Take It Down Act (2025), Section 2258A, Visa / Mastercard / Stripe / PayPal restricted-business compliance all achievable with production-grade technology |
| LLM dependency | Minimal | Image-classification stack is CV-based, not LLM-based. LLMs appear only in optional supporting roles (caption screening, manual-review triage, appeals processing) |

### C.4 Cost Structure Reference

Per-image inference costs as of 2026 commodity pricing:

| Service | Per-image cost (typical) | Notes |
|---|---|---|
| PhotoDNA hash matching | Free (Microsoft license to qualified platforms) | Tech Coalition sublicensing available |
| Hive Moderation visual classification | $0.001-0.003 per image | Volume-tiered |
| Google Cloud Vision SafeSearch | ~$0.0015 per image | Volume-tiered |
| AWS Rekognition Content Moderation | ~$0.001-0.0015 per image | Volume-tiered |
| Sensity-class AI-image detection | ~$0.005-0.01 per image | Newer market; pricing higher |
| Thorn Safer | Sliding scale; nonprofit support available | NCMEC integration included |
| Aesthetic scoring (self-hosted NIMA / LAION-Aesthetic) | Sub-cent on commodity GPU infrastructure | Once-per-Master at ingestion |

Total per-Master classifier cost in production runs approximately $0.005-$0.015 across the full §6 gate set, before manual-review queue costs (which apply only to ~10-15% of cases). Cost detail integrated in R61 Platform Cost Analysis.

---

## APPENDIX D: IMAGE ID DESIGN TRADE-OFFS

The §2.3 image-ID architecture (5-char base-36, propagated across six surfaces) carries the following pros and cons.

**Pros.**

- *Universal handle.* The same string functions as URL, filename, on-chain field, database key, and embedded metadata. No cross-surface mapping table.
- *Multi-channel recovery.* If file metadata is stripped, the in-pixel URL text and filename still recover the deed binding. If the URL is removed from a share caption, the in-pixel URL or the filename still routes back to the deed.
- *Human-readable and verbal-shareable.* Five lowercase alphanumeric characters are typeable, dictatable over voice, and case-insensitive.
- *Forensic-attribution coverage.* A leaked file whose metadata and in-pixel URL have been stripped still carries the filename channel; if every human-readable channel has been removed, the image match engine (§2.1) recovers the deed binding by near-duplicate visual match.
- *Marketing alignment.* The short URL is the shareable surface and the in-file ID is the same; one identifier funds both verifiability and discoverability.

**Cons.**

- *Immutability.* Once minted, the image ID is permanent on the deed; typos or collisions discovered post-mint cannot be reassigned cleanly without minting a new deed and burning the old.
- *Enumeration risk.* The 5-character base-36 address space is ~60M. Sequential issuance enables catalog scraping by ID-incrementing crawlers. Random issuance with collision detection mitigates but does not eliminate.
- *Capacity ceiling.* ~60M addresses cover approximately 17 years at full 10K-creator ramp (R67 §5.9). Beyond that the slug expands to 6+ characters; the format is forward-compatible by design but the rollover is a future operational event.
- *Filename mutability.* Buyers may rename downloaded files, breaking the filename-channel recovery; in-pixel URL text and metadata remain operative.
- *Privacy floor.* The public URL exposes the deed; anyone with the ID resolves to the image page, where owner attribution depends on the R67 §5.5 public/private toggle. The architecture is by design (R67 §5.9 costly-signal mechanism), not a defect.
- *Cross-surface drift.* The database can drift from on-chain truth if synchronization fails; on-chain is the source of truth and the database is a cache. Reconciliation jobs run on a schedule to detect drift.
- *Collision detection on issuance.* Random ID generation in a 60M address space requires a collision-check call on every mint; trivial computationally but adds a load-bearing step in the mint pipeline and a failure mode if the check is bypassed.

---

## APPENDIX E: INVISIBLE FORENSIC WATERMARK (DEFERRED OPTIONAL FEATURE)

An invisible forensic watermark embeds a machine-readable identity payload below the threshold of human perception, recoverable by a decoder. On a Gallery variant the payload would name the deed, the variant, the edition, and the owner ordinal, giving crop-surviving per-owner attribution: a leaked or fragmented copy could be decoded back to the owner whose copy it was, surviving re-encoding, resizing, and partial cropping.

Gallery's current protocol does not include the invisible forensic watermark. Content authentication and the verification flow (§2.1) are anchored on the on-chain content-hash record and the image match engine, neither of which depends on an embedded mark; per-buyer differentiation is carried by the visible attribution layer -- the monogram and the in-pixel URL text specified in §2.2. R65 evaluates the invisible watermark as the optional, non-load-bearing layer of the verification stack: removing it leaves every documented security threat's residual band intact, because the watermark is forgeable by construction and removable by a determined adversary, and its one distinct contribution -- forensic attribution of accidental, non-adversarial leaks -- falls outside the threat model.

The invisible watermark is recorded here as an optional feature for future consideration. It could be layered onto variant composition at a later stage, alongside the visible attribution and without disturbing the verification anchor or any other protocol decision, should crop-surviving per-owner leak attribution become a priority. The remainder of this appendix preserves the method-class analysis and the vendor-landscape survey conducted for that layer, so a future adoption decision can proceed from the existing research. The vendor capability claims below are vendor-stated and require independent technical evaluation before selection; they are catalogued as a survey, not as verified benchmarks.

### E.1 Method Class and Selection Criteria

Watermarking constructions fall into four families with materially different properties.

| Family | Mechanism | Disqualifying property for Gallery |
|---|---|---|
| Spatial-domain (LSB and variants) | Embeds in least-significant pixel bits | Destroyed by JPEG compression, which discards exactly those bits; every Gallery variant is re-encoded |
| Frequency-domain (DWT, DCT, SVD) | Embeds in transform coefficients | Survives compression, but embedding follows fixed published rules, so a knowledgeable attacker can design a targeted removal |
| Deep encoder-decoder (HiDDeN [zhu-2018], StegaStamp [tancik-2020], TrustMark, SSL) | A CNN encoder learns to distribute the payload, trained jointly with differentiable simulated distortions | None disqualifying -> the correct family for Gallery |
| In-processing / semantic (Tree-Ring, Stable Signature) | Watermark baked into a generative model's sampling process | Applicable only to AI-generated images; there is no generation process to hook for a creator-uploaded photograph |

The in-processing family is architecturally unavailable to Gallery. Gallery watermarks creator-uploaded photographs at the variant-build event; there is no diffusion sampling loop to modify, and semantic watermarks cannot operate post-hoc on an existing photograph. Gallery's choice would therefore be confined to the post-processing families, and within those the deep encoder-decoder class is correct. Within the deep class, the StegaStamp construction is the right one, for three reasons.

First, its distortion coverage matches Gallery's variant pipeline. StegaStamp's training inserts JPEG compression, blur, color shift, perspective warp, screenshot, and print-and-scan as differentiable perturbations [tancik-2020]. Gallery's variants undergo exactly these transformations between mint and circulation.

Second, it is the most resistant of the common schemes to cheap removal. This is the counterintuitive but well-documented result. Classical distortion barely dents it. The Deep-Image-Prior frequency-separation attack [liang-etal-2025] fails on StegaStamp specifically, while cleanly removing DwtDctSVD and RivaGAN. In the provable-removal study [zhao-etal-2024], StegaStamp was the holdout that resisted every method except heavily-noised diffusion regeneration.

Third, the reason it resists is structural, and it is the same property the literature recommends. StegaStamp places watermark energy in low and mid frequencies. Cheap attacks work by separating a high-frequency watermark from low-frequency image content; when the watermark is itself in the low and mid bands, that separation fails. The recommendation in [liang-etal-2025] for a removal-resistant scheme -> embed in low-frequency components with reasonable magnitude -> is a description of what StegaStamp already does.

The cost of that robustness, stated plainly: StegaStamp has the lowest imperceptibility of the common schemes. Its low and mid-frequency embedding produces the most visible distortion, a measurable PSNR penalty against DwtDctSVD or RivaGAN, observable as faint global color jitter. For Gallery this is an acceptable trade. The watermark rides on distributed variants -> the Share Copy, the listing preview, the buyer rendering -> not on the collector-grade Master held in custody, and forensic survivability matters more for those variants than perfect invisibility. Payload capacity of roughly 100 bits comfortably covers Gallery's 52-bit schema with error-correction headroom. "Best" here means best of an imperfect set: no post-processing scheme is robust against a determined regeneration adversary (R65 Appendix B.2). StegaStamp is best in the sense that it maximizes resistance to the cheap, commodity attacks while accepting a small imperceptibility cost and remaining defeatable only by the expensive attack class.

Within the StegaStamp class, any implementation selected for this optional watermark layer would have to meet the following. The first two are disqualifying rather than scored.

- **In-infrastructure embedding (disqualifying).** The clean Original is held encrypted in server-side custody (§2.2 Master Image storage) and is the canonical workhorse for every variant build. The embed operation must run inside Gallery-controlled infrastructure; the cleartext Original must not transit a third-party cloud during embedding. A SaaS-only embed API does not satisfy this; a self-hostable, on-premise, or in-VPC embedder does.
- **Open, credential-free extraction (disqualifying).** A watermark-based verification flow is meant to be runnable by the deed owner and by any third-party inspector. The embedded payload must be extractable without the vendor's account, login, or proprietary cloud tooling. Extraction gated behind a vendor credential does not satisfy this.
- **Payload capacity.** The implementation must carry at least a ten-character base-36 identity payload.
- **Robustness.** The mark must survive the stated transformations: JPEG re-encoding, format conversion, resizing within a threshold, partial cropping, screenshot capture, and print-and-scan.
- **Cost and maturity.** Per-embed operating cost, vendor stability, published corporate substance, and procurement fit for a US-domiciled issuer.

### E.2 Vendor Comparison

| Vendor | Approach | Embedding deployment | Extraction model | Payload capacity | Robustness (vendor-stated) | Cost model | Maturity / notes |
|---|---|---|---|---|---|---|---|
| SnapTag | Encryption-structured, non-AI, lightweight | Lightweight; vendor states operation on modest hardware (self-hostable) | Free "K-Safe" content-identifying API | Not published | Crop, compression, print-and-scan; fragment recovery from torn prints | Free API (association-distributed K-Safe Open API) | Korea; ~14 claimed patents; AI-content-labeling regulatory driver; claims unverified |
| Huawei Cloud DSC | Cloud watermarking service (text or image watermark) | SaaS only; cleartext image transits vendor cloud during embed | Credentialed cloud API (IAM authentication) | 32 alphanumeric characters | Survives common manipulation; 512px minimum image size | Cloud usage-based | Established hyperscaler; Chinese-hyperscaler procurement consideration for a US issuer |
| EchoMark | Perceptual embedding (Chroma color-domain, Luma spatial-domain) | SaaS | Closed-loop forensic; organization-controlled, covert | Not published | Chroma robust to digital leaks; Luma robust to print and low quality | Contact sales | US; SOC 2; per-recipient leak-attribution and insider-threat focus |
| Steg.AI | Neural / AI multi-layered watermarking (StegaStamp-class) | On-premise deployment available (Enterprise tier) | Web application and API (proprietary tooling) | Not published | Forensic; broad image-format support | $10/mo Basic (about $0.10 per operation); Enterprise contact sales | US (Irvine, CA); also offers C2PA verification; mature commercial offering |
| ForensicMark | Neural / AI watermarking with C2PA signing | On-premise Docker deployment (paid tier) | Public no-signup detection endpoint (hosted; not a distributable open SDK) | 32 characters | Greater than 50% detection under crop; greater than 80% under modification | Free tier; Custom API contact sales | Combines watermark and C2PA; MCP-native; early-stage; minimal published corporate substance, diligence required |
| Imatag | Patented steganographic invisible watermarking (INRIA-derived) | Not stated; hosted SaaS model indicated, confirm in demo | Hosted Monitor platform and API; no distributable open extractor | Not published | Compression, cropping, scaling, screenshots | Contact sales | France; INRIA spin-out; C2PA and CAI member; photo-agency and newswire customers (dpa Picture Alliance); strongest photography-domain fit |

Two vendors stand out as the leading candidates among those surveyed: Steg.AI and ForensicMark. Both are in the correct method class -- neural deep encoder-decoder watermarking -- and both offer in-infrastructure deployment (Steg.AI on-premise on its Enterprise tier, ForensicMark via on-premise Docker), so the cleartext Original need not transit a third-party cloud during embedding. Each therefore clears the method-class screen and the in-infrastructure disqualifying criterion. The remaining surveyed vendors are not suitable: SnapTag is non-AI and falls outside the deep encoder-decoder class established in E.1; EchoMark's Chroma and Luma perceptual embedding is likewise outside that class and is SaaS-only at embed; Huawei Cloud DSC fails both disqualifying criteria (SaaS-only embed, credentialed extraction); and Imatag, despite the strongest photography-domain fit, states no deployment model and publishes no distributable extractor. The open item for both leading candidates is the open, credential-free extraction criterion: neither Steg.AI nor ForensicMark publishes a distributable open extractor, so a self-hosted StegaStamp-class implementation remains the only path that cleanly satisfies that criterion and is the baseline against which Steg.AI and ForensicMark would be evaluated if this optional watermark layer is adopted.

### E.3 Watermark Scheme Disclosure in the Deed

If this optional watermark layer is adopted, the deed must record the watermark scheme: the §3.2 provenance metadata would carry a watermark scheme identifier and version field.

The reason is that watermark schemes are mutually incompatible. An extractor built for one scheme cannot read a payload embedded by another; a StegaStamp-class decoder cannot read a SnapTag mark, and neither can read a Steg.AI mark. A watermark-based verification flow begins with extracting the payload from the watermark, which silently presupposes the inspector already knows which extractor to apply. Without a scheme identifier on the deed that presupposition fails: a verifier holding a Gallery image has no way to know which decoder reads it, and the embedded payload is opaque.

Recording the scheme identifier and version in the deed closes this gap. The deed owner, a secondary marketplace, a court forensic examiner, or any other inspector reads the scheme field from the deed, obtains the matching extractor, and reads the embedded code. This also makes scheme migration safe. If Gallery changes watermark vendors, deeds minted under the prior scheme still declare it and remain verifiable with the prior extractor, while new deeds declare the new scheme. The scheme identifier is a permanent, per-deed provenance field, set at mint and never rewritten.

### E.4 Sources

External sources for this appendix, catalogued in Reference.txt: chosun-2026 (SnapTag), huawei-2026 (Huawei Cloud Data Security Center watermark API), echomark-2024 (EchoMark), stegai-2026 (Steg.AI), forensicmark-2026 (ForensicMark), imatag-2026 (Imatag), zhu-2018 (HiDDeN deep-watermarking architecture), tancik-2020 (StegaStamp construction), liang-etal-2025 (Deep-Image-Prior watermark removal), zhao-etal-2024 (provable watermark removal by regeneration).

## APPENDIX F: DOMAIN SELECTION ANALYSIS

This appendix records the evaluation of candidate domains for the public-facing platform and for the in-pixel URL text printed on distributed Share Copy variants (§2.3, §7.6), and the resulting selection.

### F.1 Evaluation

Four configurations were assessed. The in-pixel URL is measured with a representative five-character image-id slug.

| Configuration | In-pixel URL form | Glance and Lens capture | Type and search recovery | Brand and trust register | Operational structure | Assessment |
|---|---|---|---|---|---|---|
| jpg1.me (single domain) | `jpg1.me/abc1d`, about 13 characters | Shortest; the digit `1` is OCR-confusable and a typo magnet | Weak; `jpg` is a generic file-format stem with no brand-search ranking moat, and a misspelled attempt resolves to generic JPEG content | `.me` is recognized but reads in a URL-shortener register, mismatched to an authenticated fine-art product | Single domain | Rejected |
| epimage.com (single domain) | `epimage.com/abc1d`, about 17 characters | Longest; captured in full by visual search regardless of length | Strong; `epimage` is a distinctive coined word, recoverable from misspelling, and the brand owns the first result for its own name | `.com` is the trust and address-bar default; register suits a premium product | Single domain | Selected |
| epima.ge plus epimage.com (domain hack) | `epima.ge/abc1d`, about 14 characters | Near-short; `.ge` does not read as a URL to a viewer unfamiliar with the brand | Adequate, anchored by the epimage.com main site; the dot-split form is not reproduced by typing | Two unlike-looking domains split brand equity; `.ge` is an unfamiliar ccTLD | Dual domain, with a domain switch inside the funnel | Rejected |
| epimage.co plus epimage.com (TLD pair) | `epimage.co/abc1d`, about 16 characters | One character shorter than `.com`; no meaningful glance gain | Strong; the same brand name carries both TLDs | Shared brand name keeps the redirect non-alarming; `.co` is confusable with `.com` but the leak is neutralized by owning both | Dual domain | Rejected; `.co` retained only as a defensive redirect |

### F.2 Decision

The platform adopts **epimage.com** as the single canonical domain. It is used for the public site, marketing surfaces, the in-pixel URL text on Share Copy variants, the public image page, and the domain-fronted CDN delivery path (§7.3). The domains `epimage.co` and `epimage.net` are registered defensively and permanently redirected to epimage.com; they are held as redirects only, are never printed, and are not used as independent surfaces.

### F.3 Rationale

A single canonical domain gives the acquisition funnel continuity: the buyer travels from first contact to the public image page to checkout on one name, so checkout is a continuation rather than a fresh encounter with an unfamiliar domain.

`epimage` is a distinctive coined word. This matters most on the type-and-search path, which is the largest cold-acquisition channel, because a distinctive name is recoverable from an imperfect spelling, ranks first for its own brand search, and brands a reshared Share Copy even when the image is stripped of surrounding context. A generic file-format stem such as `jpg` forfeits both properties: it cannot rank for the generic term, and a mistyped attempt collapses into unrelated content. `.com` is the address-bar and trust default and is the correct register for a product positioned on authenticated one-of-one ownership.

The two dual-domain configurations were rejected for the current stage. The `epima.ge` hack splits brand equity across two unlike-looking domains and does not resolve for a viewer who does not yet recognize the `epimage` brand, which is the majority of cold viewers before the platform is established. The `epimage.co` pair shares the brand name and so avoids the equity split, but it shortens the in-pixel URL by only one character and does not justify a second active registration and a redirect layer.


## APPENDIX G: COLLABORATOR FRAMEWORK

The protocol supports on-chain collaborator attribution and automated revenue sharing for creators working with photographers, designers, production partners, and celebrity guests. At mint, the creator designates collaborators and assigns revenue split percentages encoded in the NFT's on-chain metadata. Every payment event (primary sale, resale royalty, gallery viewing fee) is automatically split per the distribution table. The split is permanent and applies for the life of the NFT.

**On-Chain Attribution.** Collaborator identity is permanently embedded in NFT metadata. Every gallery display shows collaborator credit in the provenance panel. Auto-generated profile pages display the collaborator's portfolio across the platform.

**Charity Recipients.** Charities are onboarded as a separate recipient entity class (501(c)(3) verification or international equivalent, automated payout routing, donor tax-receipt issuance). Charities do not hold deeds or wallets; they are designated proceeds destinations in primary co-branded drops and secondary resale listings.

### G.1 Celebrity Studio Session

The Celebrity Studio Session is a collaboration pattern in which a channel host and a celebrity guest jointly produce a portfolio of Master Image photographs alongside video content. The session uses the Appendix G collaborator framework with the host, celebrity, and photographer as on-chain collaborators.

| Step | Action | Output |
|---|---|---|
| Pre-session | Host and celebrity agree on revenue split through collaborator interface; photographer engaged | On-chain distribution table |
| Session | Photographer captures artistic shots during video interview; each frame is unique per content uniqueness requirement (Section 6.2) | 30-50 unique photographs |
| Video publication | Host publishes interview on YouTube -> permanent, public, timestamped record that celebrity was present in the studio | Visual evidence layer |
| Upload and co-signing | Host uploads portfolio through Studio extension; each Master minted with three collaborators (host, celebrity, photographer); celebrity's private key co-signs the mint transaction | Co-signed Master Images with dual cryptographic signatures |
| Metadata linkage | On-chain metadata includes YouTube video URL and personal quotes from creator and/or celebrity, signed by contributor's private key | Five-layer provenance chain |
| Listing | Master Images listed in Gallery through standard primary sale mechanism (Section 4.5) | Gallery-ready deeds |

The five-layer provenance chain consists of: verified creator identity, verified collaborator identity, public visual evidence (YouTube video), signed personal quote, and cryptographic on-chain proof.

**Cause-Directed Revenue.** Public figures who do not wish to personally profit can direct their revenue share to a cause or charity wallet through the collaborator framework. Cause-directed revenue flows through the Gallery's commercial sales pipeline, distinct from the platform's Stream A donation mechanism (Doc R36).

---

---

*Last Updated: 05/29/26 15:08*
