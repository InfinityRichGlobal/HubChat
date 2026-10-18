export const PAGE_SIZE = 50;
export function pageNumber(raw: string | undefined | null): number {
  const value = Number(raw ?? 1);
  return Number.isSafeInteger(value) && value > 0 && value <= 100000 ? value : 1;
}
export function pageHref(path: string, page: number, filters: Record<string, string>): string {
  return `${path}?${new URLSearchParams({ ...filters, p: String(page) })}`;
}
/** Quoted PostgREST values cannot escape into a filter expression. */
export function searchPattern(raw: string): string {
  return JSON.stringify(`%${raw.trim().slice(0, 120).replace(/[\\%_*]/g, '\\$&')}%`);
}
