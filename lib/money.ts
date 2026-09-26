// All monetary values are stored and computed as integer cents (minor units).
// Never introduce floating point arithmetic into bidding/payment math.

export function dollarsToCents(dollars: number): number {
  if (!Number.isFinite(dollars)) throw new Error('Invalid amount');
  return Math.round(dollars * 100);
}

export function centsToDisplay(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  return `${sign}$${dollars.toLocaleString('en-US')}.${remainder.toString().padStart(2, '0')}`;
}
