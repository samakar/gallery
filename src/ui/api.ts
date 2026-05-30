// api.ts
// Dev-only fetch wrapper. Reads `dev-user` from localStorage (set on Sign-in)
// and sends it as `x-dev-user` so the Express server's auth shim picks it up.
// Production replaces this with Magic DID -> session cookie (R71 §3.7 row 1).

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

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const persona = getPersona();
    const headers = new Headers(init.headers);
    if (persona) headers.set('x-dev-user', persona);
    if (init.body && !headers.has('content-type')) {
        headers.set('content-type', 'application/json');
    }
    const res = await fetch(path, { ...init, headers });
    if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<T>;
}
