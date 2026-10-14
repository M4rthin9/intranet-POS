import { PrismaClient, Prisma } from '@prisma/client';
const globalDb = globalThis as unknown as { db?: PrismaClient };
export const db = globalDb.db ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalDb.db = db;
export type Tx = Prisma.TransactionClient;
export async function transaction<T>(run: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(run, {
        isolationLevel: 'Serializable',
        timeout: 15000,
        maxWait: 10000,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2034', 'P2002'].includes(error.code) &&
        attempt < 8
      ) {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(200, 20 * 2 ** attempt) + Math.floor(Math.random() * 20)),
        );
        continue;
      }
      throw error;
    }
  }
}
