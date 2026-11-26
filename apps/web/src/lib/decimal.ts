/**
 * Exact arithmetic on the decimal strings the API sends for money and hours.
 *
 * The API works amounts out, and the browser shows them. Now and then the browser has to
 * add up what is on screen: the hours of the timesheets that are selected, or the lines of
 * an invoice, to show that they come to its total. That is done here in whole numbers of
 * the smallest unit, never in floating point, so "0.10" and "0.20" make "0.30" exactly.
 */

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

type Parsed = { units: bigint; scale: number };

function parse(value: string): Parsed | null {
  const match = DECIMAL.exec(value);
  if (!match) return null;
  const [, sign, whole = "0", fraction = ""] = match;
  const units = BigInt(whole + fraction);
  return { units: sign ? -units : units, scale: fraction.length };
}

const ZERO = BigInt(0);
const TEN = BigInt(10);

/**
 * The sum of decimal strings, written with as many decimal places as the most precise of
 * them (and never fewer than two, as amounts are written). Null if any is not a decimal.
 */
export function sumDecimals(values: readonly string[]): string | null {
  const parsed: Parsed[] = [];
  for (const value of values) {
    const item = parse(value);
    if (!item) return null;
    parsed.push(item);
  }
  const scale = Math.max(2, ...parsed.map((item) => item.scale));
  const total = parsed.reduce(
    (sum, item) => sum + item.units * TEN ** BigInt(scale - item.scale),
    ZERO,
  );
  const digits = (total < ZERO ? -total : total).toString().padStart(scale + 1, "0");
  const sign = total < ZERO ? "-" : "";
  return `${sign}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}

/** Whether two decimal strings stand for the same number: "18400" and "18400.00" do. */
export function sameDecimal(a: string, b: string): boolean {
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return false;
  const scale = Math.max(left.scale, right.scale);
  return (
    left.units * TEN ** BigInt(scale - left.scale) ===
    right.units * TEN ** BigInt(scale - right.scale)
  );
}

/** Whether a decimal string is zero, however it is written: "0", "0.00". */
export function isZero(value: string): boolean {
  return parse(value)?.units === ZERO;
}
