const GIGABYTE = 1024 ** 3;

export function bytesToGb(bytes: bigint | number): number {
  const raw = typeof bytes === 'bigint' ? Number(bytes) : bytes;
  return Math.max(0, raw / GIGABYTE);
}

export function bytesToGbString(bytes: bigint | number): number {
  const raw = typeof bytes === 'bigint' ? Number(bytes) : bytes;
  return Math.max(0, raw / GIGABYTE);
}

export function daysLeft(expireAt: Date): number {
  const diff = expireAt.getTime() - Date.now();
  return Math.ceil(diff / (24 * 60 * 60 * 1000));
}

export function sanitizeServiceName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 24);
}
