// Backdoor.tsx
// Developer-only entry point at /backdoor. Not part of the public site --
// production users see only /signin (Google-only, auto-redirects).
// Bundles every dev shortcut: persona shims, Magic test sign-in, browse
// links, "Undo sales" reset, "Create test listing" Picsum upload, sign-out.

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getActiveRole, setPersona, signOut, type DevPersona } from './api';
import { magic, type MagicProvider } from './magic';

// sessionStorage key carrying the post-signin return URL through the Magic
// OAuth round-trip (which leaves the page, so React state would die).
const RETURN_KEY = 'post-signin-return';

export default function Backdoor() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get('return');
  const [oauthPending, setOauthPending] = useState<MagicProvider | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [activeRole, setActiveRole] = useState<DevPersona | null>(getActiveRole());
  const [sample, setSample] = useState<{ image_id: string; title: string | null } | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);
  const refetchSample = () => {
    fetch('/v1/public/sample')
      .then(r => (r.ok ? r.json() : { sample: null }))
      .then(d => setSample(d.sample))
      .catch(() => setSample(null));
  };
  useEffect(refetchSample, []);

  function signInAs(persona: DevPersona) {
    setPersona(persona);
    if (returnTo) { navigate(returnTo); return; }
    if (persona === 'creator') navigate('/creator');
    else if (persona === 'buyer') navigate('/collection');
    else navigate('/admin/reviews');
  }

  async function signInWithMagic(provider: MagicProvider, returnToOverride?: string) {
    setOauthError(null);
    setOauthPending(provider);
    const target = returnToOverride ?? returnTo;
    if (target) sessionStorage.setItem(RETURN_KEY, target);
    else sessionStorage.removeItem(RETURN_KEY);
    try {
      await magic.oauth2.loginWithRedirect({
        provider,
        redirectURI: `${window.location.origin}/auth/callback`,
      });
    } catch (e: any) {
      setOauthPending(null);
      const raw = String(e?.message ?? e ?? '');
      const code = e?.code as number | undefined;
      const friendly =
        code === -32603 || raw.includes('RPC route not enabled') || raw.includes('provider not supported')
          ? `${provider[0].toUpperCase()}${provider.slice(1)} sign-in isn't enabled on Magic yet -- ` +
            'turn on the Social Login connector and paste the OAuth Client ID + Secret ' +
            'in the Magic dashboard. Use a dev persona below to continue locally.'
          : raw || 'Sign-in failed. Try again.';
      setOauthError(friendly);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="card bg-base-200 w-full max-w-sm">
        <div className="card-body items-center text-center gap-6">
          <header>
            <h1 className="text-2xl font-light">Developer backdoor</h1>
            <p className="text-xs text-base-content/50 mt-1 italic">
              Not part of the public site. Visitors land on /signin.
            </p>
          </header>

          <div className="flex flex-col gap-2 w-full">
            <button
              type="button"
              onClick={() => signInWithMagic('google')}
              disabled={oauthPending !== null}
              className="btn btn-block"
            >
              {oauthPending === 'google' ? 'Redirecting…' : 'Continue with Google'}
            </button>
          </div>

          {oauthError && (
            <p className="text-xs text-error">{oauthError}</p>
          )}

          <button
            type="button"
            onClick={async () => {
              await signOut();
              setActiveRole(null);
            }}
            className="link link-hover text-xs text-base-content/60 bg-transparent border-0 p-0"
          >
            {activeRole
              ? `Already signed in as ${activeRole}. Sign out →`
              : 'Sign out (clear any stored session) →'}
          </button>

          <div className="divider text-xs text-base-content/40 my-0">dev personas</div>
          <div className="flex flex-col gap-2 w-full">
            <button
              type="button"
              onClick={() => signInAs('creator')}
              className="btn btn-sm btn-block btn-ghost"
            >
              Continue as dev Creator
            </button>
            <button
              type="button"
              onClick={() => signInAs('buyer')}
              className="btn btn-sm btn-block btn-ghost"
            >
              Continue as dev Buyer
            </button>
            <button
              type="button"
              onClick={() => signInAs('admin')}
              className="btn btn-sm btn-block btn-ghost"
            >
              Continue as dev Admin
            </button>
          </div>

          <div className="flex flex-col gap-1 items-center">
            <button
              type="button"
              disabled={undoing}
              onClick={async () => {
                setUndoing(true);
                setUndoError(null);
                try {
                  const r = await fetch('/v1/dev/reset-sales', { method: 'POST' });
                  if (!r.ok) {
                    setUndoError(
                      r.status === 404
                        ? 'Endpoint missing. Restart dev:server so the new route loads.'
                        : `Reset failed (${r.status}).`
                    );
                  }
                } catch (e: any) {
                  setUndoError(e?.message ?? 'Network error.');
                } finally {
                  setUndoing(false);
                  refetchSample();
                }
              }}
              className="link link-hover text-xs text-base-content/50 bg-transparent border-0 p-0"
            >
              {undoing ? 'Undoing…' : 'Undo sales (reset test data) →'}
            </button>
            <button
              type="button"
              disabled={undoing}
              onClick={async () => {
                setUndoing(true);
                setUndoError(null);
                try {
                  const r = await fetch('/v1/dev/create-test-listing', { method: 'POST' });
                  if (!r.ok) {
                    setUndoError(
                      r.status === 404
                        ? 'Endpoint missing. Restart dev:server so the new route loads.'
                        : `Create failed (${r.status}).`
                    );
                  }
                } catch (e: any) {
                  setUndoError(e?.message ?? 'Network error.');
                } finally {
                  setUndoing(false);
                  refetchSample();
                }
              }}
              className="link link-hover text-xs text-base-content/50 bg-transparent border-0 p-0"
            >
              {undoing ? 'Creating…' : 'Create test listing (Picsum) →'}
            </button>
            <button
              type="button"
              disabled={oauthPending !== null}
              onClick={() => signInWithMagic('google', '/creator/youtube/connect')}
              className="link link-hover text-xs text-base-content/50 bg-transparent border-0 p-0"
            >
              {oauthPending === 'google' ? 'Redirecting…' : 'Test creator YouTube verify (Magic sign-in) →'}
            </button>
            <button
              type="button"
              disabled={undoing}
              onClick={async () => {
                setUndoing(true);
                setUndoError(null);
                try {
                  const r = await fetch('/v1/dev/send-test-email', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({}),
                  });
                  const body = await r.json().catch(() => ({}));
                  if (!r.ok) {
                    setUndoError(
                      body?.postmark_error?.Message
                        ? `Postmark: ${body.postmark_error.Message}`
                        : body?.message ?? `Test email failed (${r.status}).`
                    );
                  } else {
                    setUndoError(`Sent ✓  Message ${String(body.message_id ?? '').slice(0, 8)}…`);
                  }
                } catch (e: any) {
                  setUndoError(e?.message ?? 'Network error.');
                } finally {
                  setUndoing(false);
                }
              }}
              className="link link-hover text-xs text-base-content/50 bg-transparent border-0 p-0"
            >
              {undoing ? 'Sending…' : 'Send test email (Postmark + CMA PDF) →'}
            </button>
            <button
              type="button"
              onClick={() => navigate('/recovery-key')}
              className="link link-hover text-xs text-base-content/50 bg-transparent border-0 p-0"
            >
              View /recovery-key page →
            </button>
            <button
              type="button"
              disabled={undoing}
              onClick={async () => {
                setUndoing(true);
                setUndoError(null);
                try {
                  // Pre-flight: must be signed in via Magic with Solana wallet
                  const isLoggedIn = await magic.user.isLoggedIn();
                  if (!isLoggedIn) {
                    setUndoError('Sign in via Magic first ("Continue with Google" at top of page).');
                    return;
                  }
                  // Check Solana wallet was provisioned. Magic SDK returns
                  // wallets as an OBJECT keyed by chain name (not an array).
                  // Schema: meta.wallets.solana = { publicAddress: string | null }.
                  const meta = await magic.user.getInfo();
                  const solanaWallet = (meta.wallets as any)?.solana;
                  const address = solanaWallet?.publicAddress;
                  if (!address) {
                    setUndoError('Magic user has no Solana wallet. (Are you on the right Magic project? Dedicated Wallet required.)');
                    return;
                  }

                  // The actual test: sign the same deterministic challenge twice;
                  // ed25519 spec guarantees the bytes match. Kept as a dev
                  // diagnostic for any future signature-based crypto flow.
                  // ADR-0010 was superseded 2026-06-06 by R62 §1.5 sealed-box.
                  const challenge = 'epimage:decrypt-key:test-image-id-deterministic';
                  const encoder = new TextEncoder();
                  const msg = encoder.encode(challenge);

                  const ext = (magic as any).solana;
                  if (!ext?.signMessage) {
                    setUndoError('magic.solana.signMessage missing -- SolanaExtension not loaded.');
                    return;
                  }

                  const t0 = Date.now();
                  const sig1: Uint8Array = await ext.signMessage(msg);
                  const t1 = Date.now() - t0;
                  const t2 = Date.now();
                  const sig2: Uint8Array = await ext.signMessage(msg);
                  const t3 = Date.now() - t2;

                  const same = sig1.length === sig2.length && sig1.every((b, i) => b === sig2[i]);

                  const hex = (u: Uint8Array) =>
                    Array.from(u).map(b => b.toString(16).padStart(2, '0')).join('');
                  const truncate = (s: string) => s.slice(0, 16) + '…' + s.slice(-16);

                  if (same) {
                    setUndoError(
                      `✅ Deterministic. Address ${truncate(address)}.\n` +
                      `Sig (${sig1.length}B): ${truncate(hex(sig1))}\n` +
                      `Latency: ${t1}ms, ${t3}ms.`,
                    );
                  } else {
                    setUndoError(
                      `❌ NON-deterministic.\n` +
                      `Sig1: ${truncate(hex(sig1))}\nSig2: ${truncate(hex(sig2))}`,
                    );
                  }
                } catch (e: any) {
                  setUndoError(`Test failed: ${e?.message ?? String(e)}`);
                } finally {
                  setUndoing(false);
                }
              }}
              className="link link-hover text-xs text-base-content/50 bg-transparent border-0 p-0"
            >
              {undoing ? 'Signing…' : 'Test Solana signMessage determinism →'}
            </button>
            {undoError && (
              <p className="text-xs text-error whitespace-pre-wrap">{undoError}</p>
            )}
          </div>

          {sample && (
            <div className="flex flex-col gap-1 items-center">
              <button
                type="button"
                onClick={async () => {
                  await signOut();
                  navigate(`/${sample.image_id}`);
                }}
                className="link link-hover text-sm text-base-content/70 bg-transparent border-0 p-0"
              >
                Browse a listing without signing in →
              </button>
              <button
                type="button"
                onClick={async () => {
                  await signOut();
                  setPersona('buyer');
                  navigate(`/${sample.image_id}`);
                }}
                className="link link-hover text-sm text-base-content/70 bg-transparent border-0 p-0"
              >
                Browse a listing as dev Buyer →
              </button>
              <button
                type="button"
                onClick={async () => {
                  await signOut();
                  setPersona('buyer');
                  navigate(`/${sample.image_id}?checkout=open`);
                }}
                className="link link-hover text-xs text-base-content/50 bg-transparent border-0 p-0"
              >
                Test checkout as dev Buyer →
              </button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
