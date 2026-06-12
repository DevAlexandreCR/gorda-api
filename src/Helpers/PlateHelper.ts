export function normalizePlate(s: string): string {
  return s.toUpperCase().replace(/[\s-]/g, '')
}
