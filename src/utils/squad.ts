export function parseInternalSquadIds(raw: string | null | undefined): string[] {
  if (!raw) {
    return [];
  }

  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => !!item);
}
