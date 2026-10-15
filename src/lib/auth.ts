import { randomBytes, scryptSync, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { db, transaction } from './db';
import { AppError } from './rbac';
import { audit } from './audit';
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const strongScrypt = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const legacyScrypt = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
function passwordParts(encoded: string) {
  const [version, salt, hash] = encoded.split(':');
  if (
    !['scrypt-v2', 'scrypt'].includes(version) ||
    !salt ||
    !hash ||
    !/^[a-f0-9]{32}$/.test(salt) ||
    !/^[a-f0-9]{128}$/.test(hash)
  )
    return null;
  return {
    version,
    salt,
    expected: Buffer.from(hash, 'hex'),
    options: version === 'scrypt-v2' ? strongScrypt : legacyScrypt,
  };
}
function deriveAsync(password: string, salt: string, options: typeof strongScrypt) {
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, 64, options, (error, result) =>
      error ? reject(error) : resolve(result),
    ),
  );
}
export function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt-v2:${salt}:${scryptSync(password, salt, 64, strongScrypt).toString('hex')}`;
}
export function verifyPassword(password: string, encoded: string) {
  const parts = passwordParts(encoded);
  if (!parts) return false;
  return timingSafeEqual(scryptSync(password, parts.salt, 64, parts.options), parts.expected);
}
async function verifyAsync(password: string, encoded: string) {
  const parts = passwordParts(encoded);
  if (!parts) return false;
  return timingSafeEqual(await deriveAsync(password, parts.salt, parts.options), parts.expected);
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
  const valid = await verifyAsync(password, user?.passwordHash ?? dummyHash);
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
  const verifiedUser = await transaction(async (tx) => {
    const current = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
    if (
      !current.active ||
      current.roleName !== user.roleName ||
      current.username !== user.username ||
      (current.passwordHash !== user.passwordHash &&
        !(await verifyAsync(password, current.passwordHash)))
    )
      throw new AppError(401, 'Credentials changed. Sign in again.');
    if (current.passwordHash.startsWith('scrypt:')) {
      const salt = randomBytes(16).toString('hex');
      const passwordHash = `scrypt-v2:${salt}:${(await deriveAsync(password, salt, strongScrypt)).toString('hex')}`;
      await tx.user.update({ where: { id: current.id }, data: { passwordHash } });
      await audit(
        tx,
        { id: current.id, roleName: current.roleName, ipAddress, userAgent },
        'PASSWORD_HASH_UPGRADE',
        'User',
        current.id,
        { before: { version: 'scrypt' }, after: { version: 'scrypt-v2' } },
      );
    }
    await tx.session.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt } });
    await audit(
      tx,
      { id: user.id, roleName: user.roleName, ipAddress, userAgent },
      'LOGIN',
      'User',
      user.id,
    );
    return {
      id: current.id,
      username: current.username,
      displayName: current.displayName,
      roleName: current.roleName,
      assignedEventId: current.assignedEventId,
    };
  });
  return {
    token,
    expiresAt,
    user: verifiedUser,
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
    assignedEventId: session.user.assignedEventId,
  };
}
