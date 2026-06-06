#!/usr/bin/env node
/* =============================================================================
 * TASK FOR CLAUDE CODE
 * =============================================================================
 * GOAL
 *   Run this script against a Crossmint STAGING account and report which NFT
 *   standard Crossmint mints on Solana and how its update model works. The
 *   result decides a real architecture choice for our product (the "Gallery"
 *   deed): whether we can keep minting through Crossmint (path 1) or must mint
 *   Metaplex Core directly via the MPL Core SDK and use Crossmint only for
 *   wallet/fiat (path 2).
 *
 * WHAT THIS SCRIPT CHECKS (do not change the test logic)
 *   Q1  Standard minted on Solana: Metaplex Core / Token Metadata (pNFT) / cNFT
 *   Q2  Post-mint metadata update on Solana works (Edit NFT PATCH)
 *   Q3  Who holds the on-chain update authority (Crossmint-controlled vs ours)
 *   Q4  Burn / transferability / royalty controls are exposed
 *
 * SETUP (do this first; do NOT print or commit secrets)
 *   - Require Node >= 18 (uses global fetch). If absent, stop and tell me.
 *   - Read CROSSMINT_API_KEY from the environment. It must be a STAGING
 *     server-side key with scopes nfts.create and nfts.update. If it is missing
 *     or not a staging key, STOP and ask me -- do not invent or hardcode a key.
 *
 * ASK ME FIRST (prompt me for these before running; do not guess or use placeholders)
 *   - A real recipient inbox I control, for the --recipient flag. The throwaway
 *     test NFT is delivered to this address, so it must be a mailbox I can open.
 *   - SOLANA_DAS_RPC: a DAS-enabled Solana DEVNET endpoint (Helius/Triton). This
 *     is what answers Q3 (update authority). Ask me for it; if I say I don't have
 *     one, run anyway and flag Q3 as unverified.
 *
 * RUN (after I have given you the inbox and, ideally, the DAS RPC)
 *   node crossmint_capability_probe.js full \
 *        --recipient "email:<INBOX_I_GIVE_YOU>:solana" --save-json
 *   (This mints ONE throwaway asset on devnet. Devnet only -- do NOT pass
 *    --env production unless I explicitly say so.)
 *
 * IF SOMETHING FAILS
 *   - The mint/status/Edit-NFT request shapes follow Crossmint's documented REST
 *     API (2022-06-09). Burn/transferability/royalty shapes are best-effort.
 *   - If the on-chain asset address is not auto-extracted from the status
 *     payload, read the printed payload, find the Solana asset pubkey, and re-run
 *     `inspect --mint-address <pubkey>` (with --das-rpc if you have one).
 *   - If a call 404s (especially burn), look up the correct route/method in the
 *     Crossmint API reference at https://docs.crossmint.com and fix the single
 *     function at fault; note any change you made.
 *   - Note: Crossmint's Edit-NFT examples are all EVM, so whether Solana
 *     post-mint update actually works is a live question -- Q2's real answer is
 *     whatever the PATCH returns, not what the docs imply.
 *
 * REPORT BACK (concise, in chat -- no new files beyond crossmint_probe_result.json)
 *   1. Q1 standard (and the owning program id / DAS interface you observed)
 *   2. Q2 supported? (the HTTP status from the PATCH)
 *   3. Q3 update authority address(es), and whether it looks Crossmint-controlled
 *      or settable to one of our keys
 *   4. Q4 which of burn/transferability/royalty succeeded, with any route fixes
 *   5. Recommendation: path 1 (Core + our-settable authority -> keep Crossmint)
 *      or path 2 (Token Metadata, or Crossmint-held authority -> mint Core
 *      directly). One paragraph, tied to the evidence above.
 *
 * GUARDRAILS
 *   - Throwaway, devnet, one mint. Do not loop or bulk-mint.
 *   - Do not modify any of our other files or deed logic; this is read-only
 *     verification of a third-party API.
 *   - If you need a production key or a paid DAS endpoint to proceed, stop and
 *     ask rather than working around it.
 * ============================================================================= */

const fs = require("node:fs");
const path = require("node:path");

const API_VERSION = "2022-06-09";

// Canonical Solana program IDs used to discriminate the NFT standard via getAccountInfo owner.
const PROGRAMS = {
  CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d: "Metaplex Core (MPL Core asset)",
  metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s: "Token Metadata (metadata PDA owner)",
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: "SPL Token (legacy/pNFT mint account)",
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: "SPL Token-2022 (mint account)",
  BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY: "Bubblegum (compressed NFT)",
};
const CORE_PROGRAM = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";

// --------------------------------------------------------------------------- //
// arg parsing (dependency-free)
// --------------------------------------------------------------------------- //
function parseArgs(argv) {
  const cmd = argv[0];
  const opts = {
    env: "staging",
    collection: "default-solana",
    rpc: "https://api.devnet.solana.com",
    dasRpc: null,
    mintAddress: null,
    reupload: false,
    tries: 15,
    delay: 4,
    saveJson: false,
    recipient: null,
    nftId: null,
  };
  const map = {
    "--env": "env", "--collection": "collection", "--rpc": "rpc",
    "--das-rpc": "dasRpc", "--mint-address": "mintAddress",
    "--tries": "tries", "--delay": "delay",
    "--recipient": "recipient", "--nft-id": "nftId",
  };
  const flags = { "--reupload": "reupload", "--save-json": "saveJson" };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a in flags) { opts[flags[a]] = true; }
    else if (a in map) { opts[map[a]] = argv[++i]; }
    else { throw new Error(`unknown argument: ${a}`); }
  }
  opts.tries = parseInt(opts.tries, 10);
  opts.delay = parseInt(opts.delay, 10);
  return { cmd, opts };
}

// --------------------------------------------------------------------------- //
// Crossmint REST helpers
// --------------------------------------------------------------------------- //
function apiBase(env) {
  const host = env === "production" ? "www" : "staging";
  return `https://${host}.crossmint.com/api/${API_VERSION}`;
}

function requireKey() {
  const key = process.env.CROSSMINT_API_KEY;
  if (!key) {
    console.error("ERROR: set CROSSMINT_API_KEY (server-side key with nfts.create + nfts.update).");
    process.exit(2);
  }
  return key;
}

async function safeJson(resp) {
  try { return await resp.json(); }
  catch { return { _raw: (await resp.text()).slice(0, 2000) }; }
}

async function cmRequest(method, url, key, body) {
  const resp = await fetch(url, {
    method,
    headers: { "X-API-KEY": key, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { code: resp.status, body: await safeJson(resp) };
}

// [PATCH 2026-06-02] Crossmint deprecated the `default-solana` shortcut --
// collections must be created explicitly before NFT mint. Mirrors
// src/registry/crossmint_dispatch.ts ensureCollectionId(). Returns the new id.
async function cmEnsureCollection(env, key) {
  const url = `${apiBase(env)}/collections`;
  const { code, body } = await cmRequest("POST", url, key, {
    chain: "solana",
    metadata: {
      name: "Capability Probe (throwaway)",
      description: "Auto-created by crossmint_capability_probe.cjs to verify NFT capabilities.",
      symbol: "PROBE",
    },
  });
  if (![200, 201, 202].includes(code) || !body.id) {
    throw new Error(`COLLECTION_CREATE_FAILED: http ${code} body=${JSON.stringify(body).slice(0, 300)}`);
  }
  console.log(`  created probe collection: ${body.id}`);
  return body.id;
}

function cmMint(env, key, collection, recipient, reupload) {
  const url = `${apiBase(env)}/collections/${collection}/nfts`;
  return cmRequest("POST", url, key, {
    recipient,
    metadata: {
      name: "Gallery Capability Probe",
      image: "https://www.crossmint.com/assets/crossmint/logo.png",
      description: "Throwaway asset minted to verify standard, update authority, and mutability.",
      attributes: [{ trait_type: "probe", value: "v1" }],
    },
    reuploadLinkedFiles: reupload,
  });
}

function cmGetNft(env, key, collection, nftId) {
  return cmRequest("GET", `${apiBase(env)}/collections/${collection}/nfts/${nftId}`, key);
}

function cmEditNft(env, key, collection, nftId) {
  // Q2: post-mint metadata update.
  const url = `${apiBase(env)}/collections/${collection}/nfts/${nftId}`;
  return cmRequest("PATCH", url, key, {
    metadata: {
      name: "Gallery Capability Probe (edited)",
      image: "https://www.crossmint.com/assets/crossmint/logo.png",
      description: "Edited post-mint to verify Solana metadata mutability.",
      attributes: [
        { trait_type: "probe", value: "v1-edited" },
        { trait_type: "arweave_uri", value: "ar://PROBE_PLACEHOLDER" },
      ],
    },
    reuploadLinkedFiles: true,
  });
}

function cmBurnNft(env, key, collection, nftId) {
  // Q4 (best-effort): confirm burn route/method against API ref if this 404s.
  return cmRequest("DELETE", `${apiBase(env)}/collections/${collection}/nfts/${nftId}`, key);
}

// --------------------------------------------------------------------------- //
// Solana inspection helpers
// --------------------------------------------------------------------------- //
async function rpcCall(rpcUrl, method, params) {
  try {
    const resp = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    return await resp.json();
  } catch (e) {
    return { error: { message: String(e) } };
  }
}

async function inspectAccountOwner(rpcUrl, mintAddress) {
  // Q1 via getAccountInfo: the owning program reveals the standard. Works on any RPC.
  const res = await rpcCall(rpcUrl, "getAccountInfo", [mintAddress, { encoding: "base64" }]);
  if (res.error) return { ok: false, detail: res.error };
  const val = res.result && res.result.value;
  if (val == null) {
    return {
      ok: true, found: false,
      note: "Account not found on this RPC. If Crossmint minted a compressed NFT (cNFT), there is no "
          + "asset account -> use --das-rpc (DAS getAsset) to confirm.",
    };
  }
  const owner = val.owner;
  return {
    ok: true, found: true, owner_program: owner,
    standard: PROGRAMS[owner] || `UNKNOWN program ${owner}`,
    is_core: owner === CORE_PROGRAM,
  };
}

async function inspectDas(dasRpc, mintAddress) {
  // Q1+Q3 via DAS getAsset: interface gives the standard; authorities give the update authority.
  const res = await rpcCall(dasRpc, "getAsset", { id: mintAddress });
  if (res.error) return { ok: false, detail: res.error };
  const r = res.result || {};
  return {
    ok: true,
    interface: r.interface,     // "MplCoreAsset" | "ProgrammableNFT" | "V1_NFT" | ...
    authorities: r.authorities, // [{address, scopes}] -> who can update
    ownership: r.ownership,
    royalty: r.royalty,
    mutable: r.mutable,
  };
}

// --------------------------------------------------------------------------- //
// orchestration
// --------------------------------------------------------------------------- //
function extractAddressCandidates(nftJson) {
  const cands = {};
  const onChain = nftJson.onChain || {};
  for (const k of ["mintHash", "contractAddress", "tokenId", "address", "assetId"]) {
    if (onChain[k]) cands[`onChain.${k}`] = onChain[k];
  }
  for (const k of ["id", "tokenId"]) {
    if (nftJson[k]) cands[k] = nftJson[k];
  }
  return { cands, onChain };
}

const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

async function pollStatus(env, key, collection, nftId, tries, delay) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    const { code, body } = await cmGetNft(env, key, collection, nftId);
    last = body;
    const status = (body.onChain || {}).status;
    console.log(`  poll ${i + 1}/${tries}: http=${code} onChain.status=${status}`);
    if (["success", "completed", "minted"].includes(status)) return body;
    await sleep(delay);
  }
  return last;
}

async function cmdMint(o) {
  const key = requireKey();
  const { code, body } = await cmMint(o.env, key, o.collection, o.recipient, o.reupload);
  console.log(`POST mint -> http ${code}`);
  console.log(JSON.stringify(body, null, 2));
  if (body.id) console.log(`\nnft id: ${body.id}  (use: status/update/burn --collection ${o.collection} --nft-id ${body.id})`);
  return body;
}

async function cmdStatus(o) {
  const key = requireKey();
  const body = await pollStatus(o.env, key, o.collection, o.nftId, o.tries, o.delay);
  console.log(JSON.stringify(body, null, 2));
  const { cands } = extractAddressCandidates(body);
  console.log("\nAddress-like fields (copy the Solana asset pubkey into `inspect --mint-address`):");
  console.log(JSON.stringify(cands, null, 2));
  return body;
}

async function cmdInspect(o) {
  const out = { mint_address: o.mintAddress };
  console.log(`getAccountInfo owner check on ${o.rpc} ...`);
  const owner = await inspectAccountOwner(o.rpc, o.mintAddress);
  out.account_owner_check = owner;
  console.log(JSON.stringify(owner, null, 2));
  const das = process.env.SOLANA_DAS_RPC || o.dasRpc;
  if (das) {
    console.log(`\nDAS getAsset on ${das} ...`);
    out.das_check = await inspectDas(das, o.mintAddress);
    console.log(JSON.stringify(out.das_check, null, 2));
  } else {
    console.log("\n(no DAS RPC supplied; skipping interface/authority check. Set SOLANA_DAS_RPC or --das-rpc for Q3.)");
  }
  return out;
}

async function cmdUpdate(o) {
  const key = requireKey();
  const { code, body } = await cmEditNft(o.env, key, o.collection, o.nftId);
  console.log(`PATCH edit-nft -> http ${code}`);
  console.log(JSON.stringify(body, null, 2));
  const ok = [200, 201, 202].includes(code);
  console.log(`\nQ2 post-mint metadata update on Solana: ${ok ? "SUPPORTED" : "FAILED/UNSUPPORTED"} (http ${code})`);
  return { code, ok, body };
}

async function cmdBurn(o) {
  const key = requireKey();
  const { code, body } = await cmBurnNft(o.env, key, o.collection, o.nftId);
  console.log(`DELETE burn-nft -> http ${code}`);
  console.log(JSON.stringify(body, null, 2));
  if (code === 404) console.log("\n404 -> confirm burn route/method in the API reference (burn-nft) and adjust cmBurnNft().");
  return { code, body };
}

async function cmdFull(o) {
  const key = requireKey();
  const report = { env: o.env, recipient: o.recipient, questions: {} };

  // [PATCH 2026-06-02] Auto-create a throwaway collection if the caller is
  // relying on the deprecated `default-solana` default. Real CLI users can
  // still pass --collection <existing-id>.
  if (o.collection === "default-solana") {
    console.log("== STEP 0: create probe collection (default-solana deprecated) ==");
    o.collection = await cmEnsureCollection(o.env, key);
    report.collection_id = o.collection;
  }

  console.log("== STEP 1: mint a throwaway asset ==");
  const mintBody = await cmdMint(o);
  const nftId = mintBody.id;
  if (!nftId) {
    console.log("No nft id returned; cannot continue. Inspect the mint response above.");
    report.questions.mint = { ok: false, body: mintBody };
    maybeSave(o, report);
    return report;
  }

  console.log("\n== STEP 2: poll mint status for the on-chain address ==");
  const statusBody = await pollStatus(o.env, key, o.collection, nftId, o.tries, o.delay);
  const { cands, onChain } = extractAddressCandidates(statusBody);
  console.log("Address-like fields:", JSON.stringify(cands, null, 2));

  const mintAddress = o.mintAddress || cands["onChain.mintHash"] || cands["onChain.contractAddress"]
    || cands["onChain.assetId"] || cands["onChain.tokenId"];
  report.mint_address_used = mintAddress;
  report.onChain = onChain;

  console.log("\n== STEP 3 (Q1/Q3): inspect on-chain standard + update authority ==");
  if (mintAddress) {
    const owner = await inspectAccountOwner(o.rpc, mintAddress);
    report.questions.Q1_standard_getAccountInfo = owner;
    console.log(JSON.stringify(owner, null, 2));
    const das = process.env.SOLANA_DAS_RPC || o.dasRpc;
    if (das) {
      report.questions.Q1Q3_das = await inspectDas(das, mintAddress);
      console.log(JSON.stringify(report.questions.Q1Q3_das, null, 2));
    } else {
      console.log("(no DAS RPC; Q3 update-authority unverified. Set SOLANA_DAS_RPC for authorities[].)");
    }
  } else {
    console.log("Could not auto-extract a Solana asset address. Re-run `inspect --mint-address <pubkey>` "
      + "with the address from the status payload above.");
    report.questions.Q1_standard_getAccountInfo = { ok: false, note: "address not auto-extracted" };
  }

  console.log("\n== STEP 4 (Q2): post-mint metadata update ==");
  const { code } = await cmEditNft(o.env, key, o.collection, nftId);
  const ok = [200, 201, 202].includes(code);
  report.questions.Q2_post_mint_update = { http: code, ok };
  console.log(`PATCH edit-nft -> http ${code} -> ${ok ? "SUPPORTED" : "FAILED"}`);

  console.log("\n================ CAPABILITY REPORT ================");
  const q1 = report.questions.Q1_standard_getAccountInfo || {};
  console.log(`Q1 Standard minted on Solana : ${q1.standard || "unknown (see DAS / status payload)"}`);
  console.log(`     -> Metaplex Core?        : ${q1.is_core}`);
  console.log(`Q2 Post-mint update (Solana) : ${report.questions.Q2_post_mint_update.ok ? "SUPPORTED" : "NOT confirmed"}`);
  const das = report.questions.Q1Q3_das || {};
  console.log(`Q3 On-chain update authority : ${das.authorities ? JSON.stringify(das.authorities) : "unverified (supply SOLANA_DAS_RPC)"}`);
  console.log("     -> If the authority is a Crossmint-controlled key, updates are MEDIATED (R52 dependency);");
  console.log("        path-1. If you can set it to a Gallery key, path-2 (direct authority) is open.");
  console.log("Q4 Burn/transfer/royalty     : run `burn` and check the collection set-transferability/");
  console.log("     set-royalties routes in the API reference; see R71 deed_state + 10% royalty mapping.");
  console.log("Decision: Core + Gallery-held authority -> R62/R71 stand. Token Metadata or Crossmint-held");
  console.log("          authority -> re-spec per the path-1/path-2 split (R62/R65/R72 survival claims).");
  console.log("===================================================");

  maybeSave(o, report);
  return report;
}

function maybeSave(o, report) {
  if (o.saveJson) {
    const dir = __dirname;
    const outPath = path.join(dir, "crossmint_probe_result.json");
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log(`\nSaved: ${outPath}`);
  }
}

// --------------------------------------------------------------------------- //
// entrypoint
// --------------------------------------------------------------------------- //
const HELP = `Verify Crossmint NFT capabilities for the Gallery deed architecture.

Commands: mint | status | inspect | update | burn | full
Global flags: --env staging|production  --collection <id>  --rpc <url>  --das-rpc <url>
              --mint-address <pubkey>  --reupload  --tries <n>  --delay <s>  --save-json
Per-command: mint/full --recipient "email:you@x.com:solana" | "solana:<pubkey>"
             status/update/burn --nft-id <id>
Env: CROSSMINT_API_KEY (required), SOLANA_DAS_RPC (optional, enables Q3)`;

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
    console.log(HELP);
    process.exit(0);
  }
  const { cmd, opts } = parseArgs(argv);
  const dispatch = { mint: cmdMint, status: cmdStatus, inspect: cmdInspect, update: cmdUpdate, burn: cmdBurn, full: cmdFull };
  const fn = dispatch[cmd];
  if (!fn) { console.error(`unknown command: ${cmd}\n\n${HELP}`); process.exit(2); }
  if ((cmd === "mint" || cmd === "full") && !opts.recipient) { console.error('ERROR: --recipient required (e.g. "email:you@x.com:solana")'); process.exit(2); }
  if (["status", "update", "burn"].includes(cmd) && !opts.nftId) { console.error("ERROR: --nft-id required"); process.exit(2); }
  if (cmd === "inspect" && !opts.mintAddress) { console.error("ERROR: --mint-address required"); process.exit(2); }
  await fn(opts);
}

main().catch((e) => { console.error(e); process.exit(1); });
