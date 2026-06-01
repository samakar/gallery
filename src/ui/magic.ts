// magic.ts
// Client-side Magic SDK singleton. OAuth2 + PKCE extension wired for the
// Google / Apple connectors per R71 §2.1.
//
// Flow:
//   SignIn -> magic.oauth2.loginWithRedirect({provider, redirectURI})
//   Magic -> Google/Apple -> Magic -> /auth/callback
//   AuthCallback -> magic.oauth2.getRedirectResult() -> DID token
//   AuthCallback -> POST /v1/auth/magic with Bearer didToken -> { user_id, role }
//   localStorage stores didToken; api.ts forwards it as Authorization: Bearer
//
// The publishable key is exposed to the browser via Vite's VITE_* env
// convention; the matching secret key never leaves the server.

import { Magic } from 'magic-sdk';
import { OAuthExtension } from '@magic-ext/oauth2';

const publishableKey = import.meta.env.VITE_MAGIC_PUBLISHABLE_KEY as string | undefined;

if (!publishableKey) {
    console.warn(
        '[magic] VITE_MAGIC_PUBLISHABLE_KEY is not set -- OAuth sign-in will fail. ' +
        'Add it to .env per .env.example and restart `npm run dev`.'
    );
}

export const magic = new Magic(publishableKey ?? 'pk_live_PLACEHOLDER', {
    extensions: [new OAuthExtension()],
});

export type MagicProvider = 'google' | 'apple';

// localStorage keys for the post-redirect session. DID tokens are short-lived
// (15 min default); api.ts re-fetches via magic.user.getIdToken() when expired.
export const MAGIC_DID_KEY = 'magic-did';
export const MAGIC_USER_KEY = 'magic-user'; // JSON: { user_id, role, email }

export interface MagicUser {
    user_id: string;
    role: 'creator' | 'buyer' | 'admin';
    email: string;
}

export function getMagicUser(): MagicUser | null {
    const raw = localStorage.getItem(MAGIC_USER_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw) as MagicUser; } catch { return null; }
}

export function setMagicSession(didToken: string, user: MagicUser): void {
    localStorage.setItem(MAGIC_DID_KEY, didToken);
    localStorage.setItem(MAGIC_USER_KEY, JSON.stringify(user));
}

export function clearMagicSession(): void {
    localStorage.removeItem(MAGIC_DID_KEY);
    localStorage.removeItem(MAGIC_USER_KEY);
}

// Returns a fresh DID token, re-issuing via Magic if the cached one expired.
// Returns null if the user has no Magic session at all.
export async function getDidToken(): Promise<string | null> {
    const cached = localStorage.getItem(MAGIC_DID_KEY);
    if (!cached) return null;
    try {
        const isLoggedIn = await magic.user.isLoggedIn();
        if (!isLoggedIn) { clearMagicSession(); return null; }
        // Refresh proactively -- getIdToken() returns a new short-lived token.
        const fresh = await magic.user.getIdToken();
        localStorage.setItem(MAGIC_DID_KEY, fresh);
        return fresh;
    } catch {
        clearMagicSession();
        return null;
    }
}
