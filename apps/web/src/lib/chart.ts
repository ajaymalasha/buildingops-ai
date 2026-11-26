/**
 * Geometry for charts. Everything here works on plain numbers, which is fine for deciding
 * how tall to draw a bar. The figures a chart shows in words stay the API's decimal
 * strings and are never worked out from these.
 */

/** A decimal string as a number, for drawing only. Anything else is drawn as nothing. */
export function toNumber(value: string | null | undefined): number {
  const number = value == null ? Number.NaN : Number(value);
  return Number.isFinite(number) ? number : 0;
}

type TickOptions = {
  /** The values are counts, so the marks are whole numbers. */
  whole?: boolean;
  /** The most steps to divide the axis into. */
  steps?: number;
};

/**
 * The marks on the value axis of a bar chart: from zero, in steps people count in (1, 2,
 * 2.5 or 5 times a power of ten), up to the first mark at or above `max`. The step is the
 * smallest of those that needs no more than `steps` of them. The last mark is the top of
 * the chart, so no bar is ever cut off, and the first is zero, so the length of a bar is
 * in proportion to what it stands for.
 */
export function axisTicks(max: number, { whole = false, steps = 5 }: TickOptions = {}): number[] {
  if (!(max > 0)) return [0, 1];
  const least = max / steps;
  const magnitude = 10 ** Math.floor(Math.log10(least));
  const multiples = whole ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10];
  // The last of them is ten times the magnitude, which is always enough.
  const round = multiples
    .map((multiple) => multiple * magnitude)
    .find((candidate) => candidate >= least)!;
  const step = whole ? Math.max(round, 1) : round;
  const count = Math.ceil(max / step - 1e-9);
  // Rounded to shed what floating point adds to 0.2 times three.
  return Array.from({ length: count + 1 }, (_, index) => Number((index * step).toPrecision(12)));
}

/** How far along a bar or an axis `value` falls, as a percentage of `top`, from 0 to 100. */
export function percentOf(value: number, top: number): number {
  if (!(top > 0)) return 0;
  return Math.min(Math.max((value / top) * 100, 0), 100);
}
