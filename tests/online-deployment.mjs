// Disposable containers and random loopback ports; never changes live POS/ERP.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import http from 'node:http';

const root = resolve(import.meta.dirname, '..');
mkdirSync(join(root, '.local'), { recursive: true });
const directory = mkdtempSync(join(root, '.local', 'online-test-'));
const project = `pos-online-test-${Date.now()}`;
const hostname = 'cccpos.dpdns.org';
const token = join(directory, 'dummy-token');
writeFileSync(token, 'isolated-test-not-a-real-token');
const env = {
  ...process.env,
  COMPOSE_PROFILES: '',
  POS_HOSTNAME: hostname,
  POSTGRES_PASSWORD: 'isolated-owner',
  APP_DATABASE_PASSWORD: 'isolated-app',
  DATABASE_URL: 'postgresql://ccida_app:isolated-app@db/ccida',
  MIGRATION_DATABASE_URL: 'postgresql://ccida_owner:isolated-owner@db/ccida',
  APP_ORIGIN: 'http://192.168.0.46:8081',
  APP_ALLOWED_ORIGINS: 'http://192.168.1.46:8081',
  COOKIE_SECURE: 'false',
  CLOUDFLARE_TUNNEL_TOKEN_FILE: token,
};
function docker(args) {
  const result = spawnSync('docker', args, { env, encoding: 'utf8', timeout: 120000 });
  if (result.status !== 0)
    throw Error(`Docker ${args[0]} failed: ${result.stderr || result.error}`);
  return result.stdout.trim();
}
const base = ['compose', '-p', project, '-f', join(root, 'compose.yaml')];
const compose = [...base, '-f', join(root, 'compose.online.yaml')];
const original = JSON.parse(docker([...base, 'config', '--format', 'json']));
const config = JSON.parse(docker([...compose, 'config', '--format', 'json']));
for (const service of ['app', 'db', 'backup-worker'])
  assert.deepEqual(
    config.services[service],
    original.services[service],
    `${service} must not be overridden`,
  );
assert.equal(config.services['online-app'].environment.APP_ORIGIN, `https://${hostname}`);
assert.equal(config.services['online-app'].environment.COOKIE_SECURE, 'true');
assert.equal(config.services['online-app'].environment.APP_ALLOWED_ORIGINS, '');
for (const service of ['online-app', 'online-proxy', 'tunnel'])
  assert.ok(!config.services[service].ports?.length, `${service} must not publish a host port`);
assert.deepEqual(Object.keys(config.services.tunnel.networks), ['tunnel']);
assert.ok(!config.services['online-proxy'].networks.default);
assert.equal(config.services.tunnel.secrets[0].source, 'cloudflare_tunnel_token');
assert.ok(
  !docker([...compose, 'config', '--services'])
    .split(/\r?\n/)
    .includes('proxy'),
);
console.log(
  'PASS exact LAN app/database/worker preservation, separate secure runtime, no added host ports',
);

const backend = `${project}-backend`;
const proxy = `${project}-proxy`;
function request(port, { headers = {}, body, path = '/', timeout = 60000 } = {}) {
  return new Promise((done, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: body ? 'POST' : 'GET',
        headers: {
          Host: hostname,
          Connection: 'close',
          ...(body ? { 'Content-Length': body.length } : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () =>
          done({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );
    req.on('error', reject);
    req.setTimeout(timeout, () => req.destroy(Error('Proxy request timed out')));
    req.end(body);
  });
}
try {
  docker(['network', 'create', project]);
  const server =
    "require('http').createServer((q,s)=>{let bytes=0;q.on('error',()=>{});q.on('data',b=>bytes+=b.length);q.on('end',()=>{s.setHeader('Content-Type','application/json');s.end(JSON.stringify({headers:q.headers,bytes}))})}).listen(3000,'0.0.0.0')";
  docker([
    'run',
    '-d',
    '--name',
    backend,
    '--network',
    project,
    '--network-alias',
    'online-app',
    'node:22-alpine',
    'node',
    '-e',
    server,
  ]);
  docker([
    'run',
    '-d',
    '--name',
    proxy,
    '--network',
    project,
    '-p',
    '127.0.0.1::8080',
    '-e',
    `POS_HOSTNAME=${hostname}`,
    '--mount',
    `type=bind,source=${join(root, 'deploy', 'Caddyfile.online')},target=/etc/caddy/Caddyfile,readonly`,
    'caddy:2',
  ]);
  const port = Number(
    JSON.parse(docker(['inspect', proxy]))[0].NetworkSettings.Ports['8080/tcp'][0].HostPort,
  );
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      if ((await request(port, { path: '/proxy-health', timeout: 1000 })).status === 200) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.ok(ready);
  const response = await request(port, {
    headers: { 'CF-Connecting-IP': '203.0.113.10', 'X-Real-IP': '198.51.100.9' },
  });
  assert.equal(response.status, 200);
  assert.equal(JSON.parse(response.body).headers['x-real-ip'], '203.0.113.10');
  assert.equal(JSON.parse(response.body).headers['x-forwarded-proto'], 'https');
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal((await request(port, { headers: { Host: 'wrong.example' } })).status, 404);
  console.log('PASS tunnel client IP, HTTPS forwarding, no-store and hostname rejection');
  const photo = await request(port, { body: Buffer.alloc(20 * 1024 * 1024) });
  assert.equal(photo.status, 200);
  assert.equal(JSON.parse(photo.body).bytes, 20 * 1024 * 1024);
  assert.equal((await request(port, { body: Buffer.alloc(20 * 1024 * 1024 + 1) })).status, 413);
  console.log('PASS 20 MiB uploads and oversized-body rejection');
} catch (error) {
  const logs = spawnSync('docker', ['logs', proxy], { encoding: 'utf8', timeout: 15000 });
  process.stderr.write(logs.stderr || logs.stdout || 'No isolated proxy logs available.');
  throw error;
} finally {
  for (const container of [proxy, backend])
    spawnSync('docker', ['rm', '-fv', container], { encoding: 'utf8', timeout: 30000 });
  spawnSync('docker', ['network', 'rm', project], { encoding: 'utf8', timeout: 30000 });
}
