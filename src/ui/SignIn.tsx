// SignIn.tsx
// MVP Sign-in page (R71 §3.4 row 1).
// Design ref: /docs/ui_design.md §1 (lofi theme), §7 (/signin route).
//
// Real Magic SDK OAuth (Google / Apple) is TODO per R71 §2.1 / §3.3. Until then,
// three dev-persona buttons set localStorage['dev-user'] and route to the
// appropriate landing page; the api.ts wrapper forwards that as `x-dev-user`
// to the Express server's auth shim.

import { useNavigate } from 'react-router-dom';
import { setPersona, type DevPersona } from './api';

export default function SignIn() {
  const navigate = useNavigate();

  function signInAs(persona: DevPersona) {
    setPersona(persona);
    if (persona === 'creator') navigate('/creator');
    else if (persona === 'buyer') navigate('/collection');
    else navigate('/admin/reviews');
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="card bg-base-200 w-full max-w-sm">
        <div className="card-body items-center text-center gap-6">
          <header>
            <h1 className="text-2xl font-light">Sign in to Epimage</h1>
            <p className="text-sm text-base-content/60 mt-1">
              Dev mode -- pick a persona to continue.
            </p>
          </header>

          <div className="flex flex-col gap-2 w-full">
            <button
              type="button"
              onClick={() => signInAs('creator')}
              className="btn btn-block"
            >
              Sign in as Creator
            </button>
            <button
              type="button"
              onClick={() => signInAs('buyer')}
              className="btn btn-block"
            >
              Sign in as Buyer
            </button>
            <button
              type="button"
              onClick={() => signInAs('admin')}
              className="btn btn-block btn-neutral"
            >
              Sign in as Admin
            </button>
          </div>

          <p className="text-xs text-base-content/40">
            Magic OAuth (Google / Apple) -- TODO
          </p>
        </div>
      </div>
    </main>
  );
}
