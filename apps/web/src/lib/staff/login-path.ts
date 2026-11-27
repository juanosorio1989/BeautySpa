/**
 * Staff login url that returns to `pathname` + `search` (the query keeps e.g. `?date=`);
 * `customer` adds `&customer=1` so the page shows the client-session notice.
 */
export function staffLoginPath(locale: string, pathname: string, search: string, customer = false): string {
  const next = search ? `${pathname}?${search}` : pathname;
  return `/${locale}/staff/login?next=${encodeURIComponent(next)}${customer ? "&customer=1" : ""}`;
}
