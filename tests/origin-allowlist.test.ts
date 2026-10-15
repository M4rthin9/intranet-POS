import { describe, expect, it } from 'vitest';
import { requestOrigins } from '../src/lib/request-origins';

describe('explicit application origin allowlist', () => {
  const primary = 'http://192.168.1.46:8081';
  it('accepts both configured server addresses with exact scheme, host and port', () => {
    const origins = requestOrigins(primary, 'http://192.168.0.46:8081');
    expect(origins.has(primary)).toBe(true);
    expect(origins.has('http://192.168.0.46:8081')).toBe(true);
    for (const value of [
      'null',
      '',
      'http://evil.example',
      'http://192.168.0.46:8082',
      'https://192.168.0.46:8081',
      'http://192.168.0.46.evil.example:8081',
      'http://192.168.0.46:8081/login',
    ])
      expect(origins.has(value)).toBe(false);
  });
  it('preserves single-origin installations and normalizes configuration', () => {
    expect([...requestOrigins(primary)]).toEqual([primary]);
    expect([...requestOrigins(primary + '/', ` ${primary}, ,http://192.168.0.46:8081/ `)]).toEqual([
      primary,
      'http://192.168.0.46:8081',
    ]);
  });
  it.each([
    '*',
    'null',
    'ftp://192.168.0.46',
    'http://user:password@192.168.0.46',
    'http://192.168.0.46/path',
    'http://192.168.0.46?query=1',
    'http://192.168.0.46#hash',
  ])('rejects invalid configuration: %s', (value) => {
    expect(() => requestOrigins(primary, value)).toThrow();
  });
});
