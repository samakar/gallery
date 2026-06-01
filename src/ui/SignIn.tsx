// SignIn.tsx
// Production sign-in page (R71 §3.4 row 1). Google OAuth via Magic, nothing
// else. Auto-fires the redirect on mount -- the visitor came here to sign in,
// no reason to make them click again. /backdoor holds the dev shortcuts.

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { magic } from './magic';

// sessionStorage key carrying the post-signin return URL through the Magic
// OAuth round-trip (the redirect leaves the page, React state would die).
const RETURN_KEY = 'post-signin-return';

export default function SignIn() {
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get('return');
  const [error, setError] = useState<string | null>(null);

  // Auto-fire Google OAuth on mount. Ref-guarded against StrictMode double-effect.
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      try {
        if (returnTo) sessionStorage.setItem(RETURN_KEY, returnTo);
        else sessionStorage.removeItem(RETURN_KEY);
        await magic.oauth2.loginWithRedirect({
          provider: 'google',
          redirectURI: `${window.location.origin}/auth/callback`,
        });
      } catch (e: any) {
        const raw = String(e?.message ?? e ?? '');
        const code = e?.code as number | undefined;
        const friendly =
          code === -32603 || raw.includes('RPC route not enabled') || raw.includes('provider not supported')
            ? 'Google sign-in is not yet configured. Contact support.'
            : raw || 'Sign-in failed. Try again.';
        setError(friendly);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="card bg-base-200 w-full max-w-sm">
        <div className="card-body items-center text-center gap-6">
          <header>
            <h1 className="text-2xl font-light">Sign in to Epimage</h1>
            <p className="text-sm text-base-content/60 mt-1">
              {error ? 'There was a problem signing you in.' : 'Redirecting to Google…'}
            </p>
          </header>
          {error ? (
            <>
              <p className="text-sm text-error">{error}</p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="btn btn-block"
              >
                Try again
              </button>
            </>
          ) : (
            <span className="loading loading-spinner" />
          )}
        </div>
      </div>
    </main>
  );
}
