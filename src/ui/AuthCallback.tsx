// AuthCallback.tsx
// Magic OAuth landing page. Browser arrives here after Google / Apple round
// trip with ?code= and ?state= in the URL; we hand both to Magic, get a DID
// token, ship it to the server for provisioning, then route to the user's
// landing page by role.
//
// On any failure we redirect back to /signin with an error banner via
// router state so the user isn't stranded on a blank screen.

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { magic, setMagicSession, clearMagicSession } from './magic';

export default function AuthCallback() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<'pending' | 'error'>('pending');
  const [errMsg, setErrMsg] = useState<string | null>(null);
  // StrictMode fires effects twice in dev. magic.oauth2.getRedirectResult()
  // is single-use -- the second call throws "state already consumed" and the
  // catch block would then clearMagicSession(), wiping the session the first
  // run just stored. Ref-guard so the effect body runs exactly once.
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;
    (async () => {
      try {
        const result = await magic.oauth2.getRedirectResult();
        const didToken = result.magic.idToken;
        // Hand the DID token to the server -- it validates via @magic-sdk/admin
        // and find-or-creates the User row, returning {user_id, role, email}.
        const res = await fetch('/v1/auth/magic', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${didToken}`,
            'Content-Type': 'application/json',
          },
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.message ?? `Server rejected DID token (${res.status})`);
        }
        const session = await res.json() as { user_id: string; role: 'creator' | 'buyer' | 'admin'; email: string };
        setMagicSession(didToken, session);
        // SignIn parks `?return=/<image_id>` in sessionStorage before kicking
        // off OAuth so an anon Buy-click can bounce back to the listing.
        const returnTo = sessionStorage.getItem('post-signin-return');
        sessionStorage.removeItem('post-signin-return');
        if (returnTo) { navigate(returnTo, { replace: true }); return; }
        // Otherwise route by role -- mirrors the dev-persona dispatch in SignIn.tsx.
        if (session.role === 'creator') navigate('/creator', { replace: true });
        else if (session.role === 'admin') navigate('/admin/reviews', { replace: true });
        else navigate('/collection', { replace: true });
      } catch (e: any) {
        clearMagicSession();
        setErrMsg(e?.message ?? 'Sign-in did not complete.');
        setStatus('error');
      }
    })();
  }, [navigate]);

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="card bg-base-200 w-full max-w-sm">
        <div className="card-body items-center text-center gap-4">
          {status === 'pending' ? (
            <>
              <span className="loading loading-spinner" />
              <p className="text-sm text-base-content/60">Finishing sign-in…</p>
            </>
          ) : (
            <>
              <h2 className="card-title">Sign-in failed</h2>
              <p className="text-sm text-base-content/60">{errMsg}</p>
              <button
                type="button"
                onClick={() => navigate('/signin', { replace: true })}
                className="btn btn-sm"
              >
                Back to sign-in
              </button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
