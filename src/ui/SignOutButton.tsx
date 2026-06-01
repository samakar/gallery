// SignOutButton.tsx
// Tear down whichever session is active (Magic OAuth or dev-persona) and
// route back to /signin. Used in the Creator dashboard, Collection, and
// Admin reviews page headers.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signOut } from './api';

export function SignOutButton({ className = 'btn btn-sm btn-ghost' }: { className?: string }) {
    const navigate = useNavigate();
    const [busy, setBusy] = useState(false);
    return (
        <button
            type="button"
            disabled={busy}
            onClick={async () => {
                setBusy(true);
                await signOut();
                navigate('/signin', { replace: true });
            }}
            className={className}
        >
            {busy ? 'Signing out…' : 'Sign out'}
        </button>
    );
}
