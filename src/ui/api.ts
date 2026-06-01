// api.ts
// Fetch wrapper. Forwards one of two credentials to the Express server:
//   1. Magic DID token as `Authorization: Bearer <didToken>` -- production path.
//      Refreshed via magic.user.getIdToken() each call so the short-lived token
//      doesn't expire mid-session.
//   2. Dev persona as `x-dev-user: creator | buyer | admin` -- local-only shim
//      kept alongside Magic per R71 §3.3.
// Magic takes precedence when both are present (e.g. user signed in with Magic
// after a stale dev-persona entry from a prior session).

import { getDidToken, getMagicUser, clearMagicSession, magic } from './magic';

export type DevPersona = 'creator' | 'buyer' | 'admin';

export function setPersona(p: DevPersona): void {
    localStorage.setItem('dev-user', p);
}

export function getPersona(): DevPersona | null {
    const p = localStorage.getItem('dev-user');
    return p === 'creator' || p === 'buyer' || p === 'admin' ? p : null;
}

export function clearPersona(): void {
    localStorage.removeItem('dev-user');
}

// Tear down whichever session is active. Magic.user.logout() invalidates the
// DID server-side too; we ignore its failure (network error, expired session)
// because the localStorage clear below is what the UI actually depends on.
export async function signOut(): Promise<void> {
    clearPersona();
    if (localStorage.getItem('magic-did')) {
        try { await magic.user.logout(); } catch { /* best-effort */ }
    }
    clearMagicSession();
}

// Returns the active role from whichever session is in play. Useful for UI
// gating without a server round-trip.
export function getActiveRole(): DevPersona | null {
    return getMagicUser()?.role ?? getPersona();
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    const didToken = await getDidToken();
    if (didToken) {
        headers.set('Authorization', `Bearer ${didToken}`);
    } else {
        const persona = getPersona();
        if (persona) headers.set('x-dev-user', persona);
    }
    // Only force JSON content-type for string bodies. FormData / Blob bodies
    // must let the browser set their own multipart / mime headers (including
    // the boundary).
    if (typeof init.body === 'string' && !headers.has('content-type')) {
        headers.set('content-type', 'application/json');
    }
    const res = await fetch(path, { ...init, headers });
    if (!res.ok) {
        // Surface the server's JSON error shape ({ error, message, ...extras })
        // as a structured ApiError so callers can switch on error_code +
        // read out extras like `conflicting_image_id`.
        let body: any = null;
        let detail = `${res.status} ${res.statusText}`;
        try {
            body = await res.json();
            if (body?.error || body?.message) {
                detail = body.message
                    ? `${body.error ?? 'ERROR'}: ${body.message}`
                    : body.error;
            }
        } catch { /* not JSON; keep status text */ }
        throw new ApiError(res.status, body, detail);
    }
    return res.json() as Promise<T>;
}

// Thrown by api() on non-2xx. Use `err instanceof ApiError` to branch on
// `err.body.error` (server's error_code) and read structured extras.
export class ApiError extends Error {
    constructor(public status: number, public body: any, message: string) {
        super(message);
        this.name = 'ApiError';
    }
}
