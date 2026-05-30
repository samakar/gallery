// db.ts
// Shared Prisma client singleton. Avoids spawning multiple clients in dev
// under HMR; in production each Node process gets exactly one client.
//
// Import as: import { prisma } from '../db';

import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = prisma;
}
