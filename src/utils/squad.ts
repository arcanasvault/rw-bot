export function parseInternalSquadIds(raw: string | null | undefined): number[] {
  if (!raw) {
    return [];
  }

  return raw
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0);
}

