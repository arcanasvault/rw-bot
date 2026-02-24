export function toRials(tomans: number): number {
  return tomans * 10;
}

export function toTomans(rials: number): number {
  return Math.floor(rials / 10);
}

export function formatTomans(amount: number): string {
  return `${amount.toLocaleString('fa-IR')} تومان`;
}
