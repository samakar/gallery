// image_id_generator.ts
// 5-char base-36 lowercase universal handle (INV-3).
// Spec: /docs/registry/image_id_generator.md
//
// Uniqueness is verified at insert time via images.image_id UNIQUE constraint;
// the caller retries `generate()` on collision (rare at MVP scale: 36^5 = ~60M).

import { randomBytes } from 'node:crypto';

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz"; // base-36

export function generate(): string {
    const bytes = randomBytes(5);
    let id = "";
    for (let i = 0; i < 5; i++) {
        id += ALPHABET[bytes[i] % 36];
    }
    return id;
}
