/** Currencies offered in settings. Any ISO 4217 code is valid; these are the common ones. */
export const COMMON_CURRENCIES = [
  "USD",
  "CAD",
  "EUR",
  "GBP",
  "AUD",
  "MXN",
  "INR",
  "AED",
  "SGD",
  "JPY",
];

/** IANA time zones grouped by region, for a select. `include` is kept even if unlisted. */
export function groupedTimeZones(include?: string): [region: string, zones: string[]][] {
  const zones = new Set(Intl.supportedValuesOf("timeZone"));
  if (include) zones.add(include);
  const groups = new Map<string, string[]>();
  for (const zone of [...zones].sort()) {
    const region = zone.includes("/") ? zone.slice(0, zone.indexOf("/")) : "Other";
    groups.set(region, [...(groups.get(region) ?? []), zone]);
  }
  return [...groups.entries()];
}

/** "America/Argentina/Buenos_Aires" -> "Argentina / Buenos Aires" */
export function timeZoneLabel(zone: string): string {
  const city = zone.includes("/") ? zone.slice(zone.indexOf("/") + 1) : zone;
  return city.replace(/_/g, " ").replace(/\//g, " / ");
}
