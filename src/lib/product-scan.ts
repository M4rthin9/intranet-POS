const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/** Short, stable IDs keep Code 128 tags readable without embedding prices. */
export function productScanValue(id: string) {
  if (!uuidPattern.test(id)) throw new Error('A valid product ID is required.');
  const bytes = id
    .replaceAll('-', '')
    .match(/../g)!
    .map((value) => parseInt(value, 16));
  return (
    'P:' +
    btoa(String.fromCharCode(...bytes))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/, '')
  );
}

export function productIdFromScan(value: string): string | null {
  if (!/^P:[A-Za-z0-9_-]{22}$/.test(value)) return null;
  try {
    const bytes = atob(value.slice(2).replaceAll('-', '+').replaceAll('_', '/') + '==');
    const hex = Array.from(bytes, (character) =>
      character.charCodeAt(0).toString(16).padStart(2, '0'),
    ).join('');
    const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    return uuidPattern.test(id) && productScanValue(id) === value ? id : null;
  } catch {
    return null;
  }
}

export function scannedProduct<T extends { id: string; code: string }>(
  products: readonly T[],
  value: string,
): T | undefined {
  const scan = value.trim();
  if (scan.startsWith('P:')) {
    const id = productIdFromScan(scan);
    return id ? products.find((product) => product.id.toLowerCase() === id) : undefined;
  }
  return products.find((product) => product.code === scan);
}
