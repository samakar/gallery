// image_id_generator.ts
// 5-char base-36 lowercase universal handle (INV-3).
//
// Deterministic: same seed -> same id. Production callers pass a per-upload
// seed (e.g., `${user_id}-${Date.now()}-${retry}`); the resulting id is
// reproducible from the same inputs, which is convenient for testing and
// post-hoc reconstruction.
//
// Uniqueness is verified at insert time via images.image_id UNIQUE constraint;
// the caller retries with an incremented seed suffix on collision (rare at
// MVP scale: 36^5 = ~60M).

import { createHash } from 'node:crypto';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

export function generate(seed: string | number): string {
    const digest = createHash('sha256').update(String(seed)).digest();
    let id = '';
    for (let i = 0; i < 5; i++) {
        id += ALPHABET[digest[i] % 36];
    }
    return id;
}
