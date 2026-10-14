import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { db, transaction } from './db';
import { AppError } from './rbac';
import { audit } from './audit';
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function verifyPassword(password: string, encoded: string) {
  const [, salt, hash] = encoded.split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}
const dummyHash = hashPassword('constant-time-invalid-login');
export async function login(
  username: string,
  password: string,
  ipAddress: string,
  userAgent?: string,
) {
  const key = hashToken(`login:user:${username.toLowerCase()}`);
  const limited = await db.$queryRaw<Array<{ count: number }>>`
    INSERT INTO "RateLimit" ("key", "count", "windowStart") VALUES (${key}, 1, NOW())
    ON CONFLICT ("key") DO UPDATE SET "count" = CASE WHEN "RateLimit"."windowStart" < NOW() - INTERVAL '15 minutes' THEN 1 ELSE "RateLimit"."count" + 1 END,
    "windowStart" = CASE WHEN "RateLimit"."windowStart" < NOW() - INTERVAL '15 minutes' THEN NOW() ELSE "RateLimit"."windowStart" END RETURNING "count"`;
  if (limited[0].count > 10)
    throw new AppError(429, 'Too many login attempts. Try again in 15 minutes.');
  const user = await db.user.findUnique({ where: { username } });
  const valid = verifyPassword(password, user?.passwordHash ?? dummyHash);
  if (!user || !user.active || !valid) {
    await db.auditLog.create({
      data: {
        actorUserId: user?.id ?? 'anonymous',
        actorRole: user?.roleName ?? 'UNAUTHENTICATED',
        action: 'LOGIN_FAILED',
        entityType: 'User',
        entityId: user?.id ?? 'anonymous',
        ipAddress,
        userAgent,
      },
    });
    throw new AppError(401, 'Invalid username or password.');
  }
  const token = randomBytes(32).toString('base64url');
  const hours = Number(process.env.SESSION_HOURS ?? 8);
  if (!Number.isFinite(hours) || hours < 1 || hours > 24)
    throw new AppError(503, 'SESSION_HOURS must be between 1 and 24.');
  const expiresAt = new Date(Date.now() + hours * 3600000);
  await transaction(async (tx) => {
    await tx.session.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt } });
    await audit(
      tx,
      { id: user.id, roleName: user.roleName, ipAddress, userAgent },
      'LOGIN',
      'User',
      user.id,
    );
  });
  return {
    token,
    expiresAt,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      roleName: user.roleName,
    },
  };
}
export async function authenticate(token?: string) {
  if (!token) throw new AppError(401, 'Please sign in.');
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date() || !session.user.active)
    throw new AppError(401, 'Session expired. Please sign in again.');
  return {
    id: session.user.id,
    username: session.user.username,
    displayName: session.user.displayName,
    roleName: session.user.roleName,
  };
}
