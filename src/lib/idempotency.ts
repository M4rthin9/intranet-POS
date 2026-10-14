import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { transaction, type Tx } from './db';
import { AppError } from './rbac';
import type { Actor } from './audit';
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export async function idempotent<T>(
  actor: Actor,
  action: string,
  key: string,
  input: unknown,
  run: (tx: Tx) => Promise<T>,
): Promise<T> {
  const digest = (v: string) => createHash('sha256').update(v).digest('hex');
  const id = digest(`${actor.id}:${action}:${key}`);
  const requestHash = digest(canonical(input));
  return transaction(async (tx) => {
    const previous = await tx.idempotencyRecord.findUnique({ where: { key: id } });
    if (previous) {
      if (previous.requestHash !== requestHash)
        throw new AppError(409, 'This request key was already used for different data.');
      return previous.response as T;
    }
    const result = await run(tx);
    const json = JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue;
    await tx.idempotencyRecord.create({
      data: { key: id, actorUserId: actor.id, action, requestHash, response: json },
    });
    return result;
  });
}
