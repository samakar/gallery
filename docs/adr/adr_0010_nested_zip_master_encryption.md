# ADR-0010 -- Nested ZIP-AES-256 Master Encryption for Native Post-Cessation UX

## Status

**Superseded 2026-06-07 by R62 §1.5 (user directive: "MVP implementation on inner key must match R62 at MVP").**

Brief life: Accepted 2026-06-06, shipped end-to-end the same day, verified against a real devnet mint (image_id `es0rx`, asset `B559bTPJrm...AEWYX`), superseded the following morning when the user opted to align MVP encryption with R62 §1.5 directly rather than ship a UX-optimized divergence.

### What was superseded

The nested ZIP-AES-256 envelope as the Arweave-bound encryption form. Specifically:
- `outer_password = SHA256(PLATFORM_DEK || image_id)` -- replaced by R62's `aes(PLATFORM_DEK, ...)` outer layer of `enc_final`
- `inner_password = SHA256(buyer_signature || image_id)` -- replaced by R62's `sealed_box(DEK_image, owner_wallet_pubkey)` asymmetric inner layer
- BuyWizard wallet-signing step at the monogram form -- removed; R62's sealed-box uses the wallet pubkey at mint time (no signature needed)
- `Purchase.buyer_signature_b64` column -- dropped (migration `20260607064139_drop_purchase_buyer_signature`)
- `src/cert/zip_envelope.ts` + `archiver` / `archiver-zip-encrypted` / `7zip-bin` deps -- removed

### What survives

- **The master-bytes refactor.** The cleanup that established the Arweave-bound payload as the original full-resolution Master (not the Cloudinary listing-preview) per ADR-0010's investigation of fetch sources is kept in the R62-aligned implementation. Verified: certify-time `sha256` over `req.file.buffer`, `buildOriginalUrl()` returns the no-transformation Cloudinary URL, `arweave_master.ts` fetches from there.
- **Magic SDK Solana signMessage determinism finding.** Confirmed deterministic + cross-session-stable. Captured as a dev diagnostic in `src/ui/Backdoor.tsx`. Useful for any future signature-derived flow.
- **The "draft" pre-sale deed_state UX.** Independent of encryption; stays.
- **Certify-time `Image.sha256` populate + the `HashCell` UI component.** Independent of encryption; stays.

### Why superseded

R62 §1.5 already specifies a doubly-nested envelope that (a) preserves per-owner post-cessation exclusivity (inner asymmetric to wallet pubkey), (b) supports resale re-key on-chain via `update_metadata_v1` (the Arweave bytes don't need to rotate), and (c) is what every spec doc references. ADR-0010's signature-derived inner password achieved the same security model but via a different cryptographic primitive that:
- Cannot be re-keyed on resale (ZIP file is byte-immutable per Arweave; inner password is bound to the original buyer's signature forever)
- Diverges from every existing spec doc, creating sustained translation burden across the doc tree (D-15)
- Optimizes for native-tool post-cessation UX, which R72 §2.8's reference recovery client is going to provide anyway

The user concluded that maintaining R62 fidelity at MVP is worth the loss of "decryption via 7-Zip alone" -- recovery becomes "fetch Arweave + run small CLI" instead.

### Original ADR-0010 content (preserved below for history)

The remainder of this document is the original 2026-06-06 ADR text, kept verbatim so the supersession rationale has the full context it was rejecting. No further edits.

---

## Status (original)

Accepted (2026-06-06).

## Context

R62 §2.3 specifies the Master encryption envelope as `enc_final = encrypt(encrypt(DEK_image, owner_wallet_pubkey), platform_DEK)` -- asymmetric inner wrap, symmetric outer wrap, custom on-chain encoding. The intended decryption paths:

- **Operational life**: platform-mediated via the Master Download endpoint (§3.5.1). Owner clicks Download → server decrypts from server-side custody → streams plaintext JPEG with `Content-Disposition: attachment`. Produces an on-chain `sealed → opened` audit record and disables resale (§3.8 state machine).
- **Post-cessation**: trustee publishes `platform_DEK` on-chain → each owner uses their wallet to peel the inner asymmetric layer → recovers `DEK_image` → decrypts the encrypted Master from Arweave.

The operational-life path is implemented and ships at MVP. The post-cessation path is architecturally sound but **practically inaccessible to non-technical owners**:

1. The encrypted Master on Arweave uses raw AES-256-GCM ciphertext with custom envelope encoding. No standard tool (Photos, Files, Preview, Quick Look, Archive Utility, 7-zip, WinRAR) recognizes the format.
2. Owners who click the Arweave URL during operational life download what looks like a corrupted file -- no extension, opaque binary. Reads as platform brokenness to users despite being the correct architectural behavior.
3. Owner-sovereign decryption (R62 §3.5.1 buyer-signed challenge / Path 1) requires a custom Epimage CLI tool. Tool doesn't exist yet; even if it ships, technical users would have to install + run it.
4. The verifiability story is therefore platform-dependent: "trust us that what's on Arweave is your image" works socially but doesn't satisfy users who want to independently verify.

This is the **post-cessation usability gap**. It's not a security gap (R62's design is cryptographically sound), but it degrades the "200-year permanence" promise from "any buyer can self-recover" to "any buyer with a CLI and Epimage's published runbook can self-recover."

## Decision

Replace R62 §2.3's custom envelope with **nested ZIP-AES-256**:

```
Master JPEG
    │ ZIP-AES-256 with inner_password = SHA256(buyer_wallet_signature || image_id)
    ▼
inner.zip
    │ ZIP-AES-256 with outer_password = SHA256(platform_DEK || image_id)
    ▼
outer.zip       ← this is what goes on Arweave; Image.arweave_uri points at it
```

Specifically:

- **File format**: standard ZIP archive with AES-256 encryption (WinZip AE-2 spec). Universally supported on Windows 10+, macOS, iOS, Android, Linux without third-party software.
- **Inner password**: SHA-256 of `(buyer_wallet_signature || image_id)`. Signature obtained by asking the buyer's wallet (Magic / Phantom) to sign the deterministic challenge `"epimage:decrypt-key:<image_id>"`. ed25519 produces deterministic signatures, so the password is reproducible from the same wallet + challenge forever.
- **Outer password**: SHA-256 of `(platform_DEK || image_id)`. Domain-separated per image (no rainbow-table attack against the platform key). Platform alone knows it during operational life; trustee publishes `platform_DEK` post-cessation, allowing anyone to derive any image's outer password.
- **Operational-life Master Download path**: UNCHANGED. Server decrypts from server-side custody (the encrypted Original held with `dek_wrapped`), streams plaintext JPEG. The Arweave ZIP is the post-cessation backup, not the operational source. Audit trail (sealed → opened) and resale-disabling preserved per R62 §3.5.1.
- **Server-side custody**: UNCHANGED. The Original is still held server-side, encrypted with `DEK_image` wrapped to `platform_DEK` (the existing `dek_wrapped` path). The new ZIP envelope sits beside this, not on top of it.
- **Encryption helper**: new `src/cert/zip_envelope.ts` exposing `buildNestedZip(jpegBuffer, signature, image_id)` returning the outer ZIP bytes ready for Arweave upload.
- **Buyer signature acquisition**: client-side (BuyWizard) calls `magic.solana.signMessage(challenge)` or equivalent Phantom call before mint dispatch. Signature passed to the server as an additional field on the start-build call.

## Consequences

### Positive

- **Native post-cessation UX.** Anyone with the outer ZIP + the trustee-published `platform_DEK` can extract the inner ZIP using built-in OS tools. Anyone with the inner ZIP + their wallet can extract the JPEG. Two double-clicks + two password prompts. No Epimage software required, ever.
- **Looks correct during operational life.** Owners who click the Arweave URL get a ZIP file with their image_id in the filename. Even if they can't open it without the trustee key (which doesn't exist yet during operational life), the format itself reads as "a sealed archive" rather than "broken data." The verifiability story becomes intuitive: "your image is in there, protected by your wallet and our trustee key."
- **Aligns with INV-02 buyer-signed-challenge framing.** R62 §3.5.1's Path 1 / INV-02 specify owner decryption via wallet-signed challenge. The asymmetric scheme in R62 §2.3 was one way to implement this; ZIP-AES-256 with signature-derived password is another. Same conceptual primitive, more user-friendly form.
- **Verifiability becomes architectural, not platform-dependent.** Anyone -- including legal counsel, auction houses, art-market analysts -- can confirm the bytes on Arweave are a real encrypted Master without trusting Epimage's word. They see a ZIP, recognize the format, know the standard tools that decrypt it.
- **No change to operational-life security model.** Platform still mediates Master Download with full audit trail and resale-disabling. Content moderation lever intact (platform refuses Master Download during DMCA / takedown investigation; buyer can technically still fetch the ZIP from Arweave + derive inner_password to recover the JPEG, but this is the same residual risk that exists for R62's encrypted-bytes-on-Arweave scheme -- a determined buyer with a CLI could already extract their image during a takedown investigation under R62 §2.3 too).
- **Threat-model equivalence.** Attacker requirements to decrypt are identical to R62 §2.3 -- address alone gives nothing, platform_DEK alone gives nothing, privkey alone gives nothing, both secrets together give full access. See ADR's "Threat-model parity" appendix.

### Trade-off accepted: platform-side recoverability from Arweave is removed

A consequence specific to this design choice (raised + accepted 2026-06-06): under R62 §2.3 as previously implemented, the platform could in principle recover a lost Original from Arweave using its own `PLATFORM_DEK` + the DB-stored `dek_wrapped` -- effectively making Arweave a platform-recoverable backup. ADR-0010 closes that "backdoor" by design: with the inner ZIP layer keyed to the buyer's wallet signature, the platform cannot recover an Original from Arweave alone (would require each buyer's individual cooperation to re-sign the deterministic challenge).

R62 §3.5 actually intends Arweave as the **per-owner trustless archive** for post-cessation, NOT as a platform-side operational backup. R65 §3.14 (S3 Glacier IR + AWS KMS + HSM-backed CMK + cross-region replication) is the spec-mandated operational backup tier. ADR-0010 aligns with R62/R65 intent: server-side custody (R65 §3.14 level) is the operational backup; Arweave is the post-cessation owner-recovery channel; platform is no longer accidentally backdoored into Arweave-side recovery.

**Operational implication for MVP:** R65 §3.14 (S3 Glacier IR + AWS KMS + HSM) is explicitly out of MVP scope (per R71 / go-live checklist). MVP server-side custody is local disk at `data/encrypted_masters/<image_id>.bin` + env-secret `PLATFORM_DEK`. Under ADR-0010, this local-disk custody becomes a single point of failure for platform-side recoverability -- if the local disk fails, the platform cannot recover Originals without each buyer's wallet signature. Accepted at MVP because:
- Buyer-sovereign access is the user-facing improvement worth shipping
- Local disk failure is mitigated by routine OS-level backups + the local-disk pattern was already a single point of failure pre-ADR (DB-stored `dek_wrapped` would also need to survive)
- R65 §3.14 upgrade is on the go-live checklist; ZIP scheme is forward-compatible (when S3/KMS ships, ADR-0010 still works without modification)

### Negative

- **Documented divergence from R62 §2.3 as written.** R62 specifies asymmetric inner wrap to `owner_wallet_pubkey`; this ADR uses signature-derived symmetric password. Functionally equivalent in security but a real spec divergence. Captured here + in divergences.md.
- **Wallet-determinism dependency.** Signature reproducibility requires deterministic signing. Solana ed25519 ✅. Magic SDK abstraction over Solana ✅ (verified). Other wallets that may be added post-MVP need vetting.
- **Slightly larger Arweave footprint.** ZIP nesting adds ~200 bytes per layer (file headers, central directory, AES-256 IV/salt). Negligible vs the 8 MB Master.
- **Inner ZIP filename leaks the image_id.** Anyone fetching the Arweave URL sees that there's a file named `<image_id>.jpg` inside the inner ZIP. But the deed's on-chain metadata already publishes the image_id, so this is no new leak.
- **PBKDF2 iteration count in WinZip AE-2 spec is 1000.** Low by modern standards (current recommendation is 100k+). Mitigated by the fact that input passwords are derived from a 64-byte ed25519 signature + 32-byte platform key -- entropy is too high for brute force to be feasible regardless of iteration count.
- **One-off code work**: ~1.5 days. Encryption pipeline refactor + buy-wizard wallet-signing step + spec updates + retest one mint.

### Native-tool support nuance (post-installation discovery)

The `archiver-zip-encrypted` README clarifies that AES-256 ZIP extraction requires:
- ✅ Windows 11 23H2+ (libarchive integration added native AES ZIP read/extract in late 2023)
- ✅ macOS Archive Utility (recent versions)
- ✅ iOS Files app (iOS 16+)
- ✅ Android Files / Google Files (recent)
- ✅ Linux: standard `unzip` 6.0+ with `--encryption` flag, or 7-zip / file-roller
- ❌ Windows 10 and Windows 11 (verified 2026-06-06 against Windows 11 Pro 10.0.26200): Windows Explorer CAN browse the archive listing (file names aren't encrypted by spec) but **cannot extract** AES-256 entries -- it silently writes the still-encrypted bytes to the destination and then fails on the second layer with "destination file could not be created". Users need **7-zip** (free; verified end-to-end 2026-06-06 -- both layers extract programmatically with the derived passwords). **WinRAR is NOT a supported reader**: the `archiver-zip-encrypted` plugin uses WinZip AE-2 spec (CRC=0), which recent WinRAR versions reject with "incorrect password" even when the password is correct. Plugin README explicitly lists only 7-zip and WinZip as compatible. Recommend buyers install 7-zip from https://www.7-zip.org/ as the documented post-cessation tool.

This is a softer "native UX" guarantee than originally framed. For the post-cessation horizon (10+ years out), Windows 10's market share will be near-zero, so the limitation is fairly time-limited. For MVP buyers on Windows 10, the Master Download endpoint (server-mediated) remains the primary UX -- buyers don't fetch from Arweave during operational life anyway. The Arweave ZIP is the post-cessation backup that becomes load-bearing only AFTER Epimage shuts down, by which point Windows 10 will be unsupported.

ADR-0010 stays AES-256 (vs the cryptographically broken legacy ZipCrypto / Zip 2.0 alternative). Accept the Windows-10-needs-7zip caveat.

### Determinism verification (2026-06-06)

Pre-implementation determinism check via the Backdoor `Test Solana signMessage determinism` button (src/ui/Backdoor.tsx):

| Check | Result |
|---|---|
| Magic SDK exposes `magic.solana.signMessage` (via `@magic-ext/solana`) | ✅ Confirmed; signature is `(message: string \| Uint8Array) => Promise<Uint8Array>` |
| Within-session determinism (same Magic session, same challenge, twice) | ✅ Byte-identical 64-byte signatures |
| Wallet address stability | ✅ `A2kfVCCRKCE3...4rYk9c2JJkKnGozr` matches the address used throughout the session for cNFT mint |
| Signing latency | ~2 s first call (cold), ~1 s subsequent (warm). Acceptable for a one-shot mint-time signing operation |
| Cross-session determinism (sign out + sign back in via same Google email + re-run) | ✅ Verified -- byte-identical 64-byte signature reproduced post-sign-out + fresh Google OAuth login. Wallet address unchanged. Magic Dedicated-Wallet derivation is deterministic per session AND across sessions for the same OAuth identity |

ed25519 determinism is RFC-8032 spec guarantee. Magic SDK delegates to the underlying Solana wallet which honors the spec. Verified Level-1 is sufficient prerequisite confidence to proceed with implementation.

### Operational obligations

- New env var: none. Existing `PLATFORM_DEK` is reused as the outer-layer secret.
- **Buyer-signature deterministic-derivation runbook**: document the exact challenge string and KDF, so a future tool (or a future trustee) can reproduce the password derivation. Lives in arweave_master.md.
- **Trustee post-cessation runbook**: at platform cessation, trustee publishes `platform_DEK` on-chain. Owners use their wallet (or saved Magic recovery flow) to sign the deterministic challenge and derive their inner password. Lives in a new docs/registry/trustee.md (post-MVP).
- **Operational-life monitoring**: Master Download endpoint behavior unchanged; existing logs / alerts apply.
- Pino log line per ZIP build: `zip_envelope.build` with `image_id`, `jpeg_size`, `outer_zip_size`, `compression_ratio`. No secrets logged.

## Boundary conditions

Revisit this ADR if any of the following hold:

- **A wallet ecosystem we plan to support introduces non-deterministic signing.** Today (June 2026) all in-scope wallets (Magic-via-Solana, Phantom, Solflare) use deterministic ed25519. If a future wallet onboarding uses randomized signing, this ADR breaks for that wallet and must be revisited.
- **PBKDF2-HMAC-SHA1 in WinZip AE-2 spec is broken cryptanalytically.** Unlikely in the next decade; revisit if any practical attack on AES-256 itself emerges.
- **Magic SDK's deterministic key derivation changes.** Magic could in principle change how they recover wallets across logins. If they did, buyers might lose access to their Magic wallet → can't reproduce signature → can't derive inner_password. This is the same risk as R62 §2.3's asymmetric scheme; same fix (export wallet privkey on enrollment).
- **A user-research signal demonstrates the operational-life "encrypted Arweave URL feels broken" framing is wrong.** If buyers stop clicking the Arweave URL and stop reading it as broken, the rationale for this ADR weakens; could revert to R62 §2.3 as written.

Specifically NOT in scope for this ADR:

- The post-cessation trustee designation itself (a separate operational decision; documented in docs/registry/trustee.md, TBD).
- A browser-based decryption tool at verify.epimage.com (post-MVP polish; the native OS unzip already covers the basic case).
- Migration of any existing deeds minted before this ADR ships. Pre-existing deeds keep their R62 §2.3 encryption; the new format applies only to deeds minted after the cutover commit.

## References

| Reference | Purpose |
|---|---|
| R62 §2.3 | Original `enc_final = encrypt(encrypt(DEK_image, owner_wallet_pubkey), platform_DEK)` spec; this ADR diverges in implementation form |
| R62 §3.5.1 | Master access / decryption / seal-break semantics; operational-life flow preserved |
| R62 §3.8 image lifecycle | `sealed → opened → traded-in / rights-disputed / void / burned` state machine; resale-disabling preserved |
| R65 §3.14 | Decryption-key architecture rationale; ZIP scheme preserves the nested-envelope intent |
| Constitution INV-02 | Platform MUST NOT hold buyer private keys; Path 1 decryption uses buyer-signed challenge. ZIP scheme implements this via signature-derived password. |
| Constitution INV-04 | No pixel modification of the Master after ingestion; ZIP encryption is pixel-preserving. |
| Constitution INV-09 | Server-side gates may call vetted external APIs; ZIP encryption is local server work, no external API. |
| /docs/cert/arweave_master.md | Subsystem spec, updated to reflect this ADR |
| /docs/divergences.md | D-15 row added capturing the R62 §2.3 divergence |
| WinZip AE-2 spec | https://www.winzip.com/win/en/aes_info.html (canonical ZIP-AES-256 reference) |

---
*Last Updated: 26/06/06 16:15*
