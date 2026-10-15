/** Only explicitly configured HTTP(S) origins may submit browser writes. */
export function requestOrigins(primary: string, additional = ''): ReadonlySet<string> {
  const values = [primary, ...additional.split(',').filter((value) => value.trim())];
  return new Set(
    values.map((value) => {
      const url = new URL(value.trim());
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.pathname !== '/' ||
        url.search ||
        url.hash
      )
        throw new Error('Configure full HTTP(S) origins without paths or credentials.');
      return url.origin;
    }),
  );
}
