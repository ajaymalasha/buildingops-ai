"use client";

import { useState } from "react";

import { axisTicks, percentOf } from "@/lib/chart";
import { cn } from "@/lib/utils";

/** What a series is drawn in: pine for what comes in, graphite and a quieter tone for costs. */
export type ChartTone = "brand" | "graphite" | "muted";

const SOLID: Record<ChartTone, string> = {
  brand: "bg-brand-600",
  graphite: "bg-ink-muted",
  muted: "bg-line-strong",
};

// A hatched bar is drawn in its text colour. The quiet tone is taken a step darker, or
// its hatching would not show against the page.
const HATCHED: Record<ChartTone, string> = {
  brand: "hatched text-brand-600 ring-1 ring-inset ring-brand-600",
  graphite: "hatched text-ink-muted ring-1 ring-inset ring-ink-muted",
  muted: "hatched text-ink-subtle ring-1 ring-inset ring-line-strong",
};

export type ChartSeries = {
  key: string;
  label: string;
  tone: ChartTone;
  /** Series that share a stack are drawn as one bar, the first of them at the bottom. */
  stack?: string;
};

export type ChartCell = {
  text: string;
  /** Set in the critical colour: a loss. */
  critical?: boolean;
};

export type ChartPoint = {
  key: string;
  /** Under the column: "Nov". */
  label: string;
  /** A quieter second line under the label: the year, where it changes. */
  detail?: string;
  /** Not final yet, such as the month still running. Drawn hatched. */
  partial?: boolean;
  /** One number for each series, for drawing only. */
  values: Record<string, number>;
  /** What the point is called in full: "November 2026, to date". */
  title: string;
  /** The figures in words, one for each heading after the first. */
  cells: readonly ChartCell[];
};

type BarChartProps = {
  /** Names the chart, and captions the table that says the same in words. */
  label: string;
  series: readonly ChartSeries[];
  points: readonly ChartPoint[];
  /**
   * Headings for the figures in words: what a point is, then one for each of its cells.
   * A heading that is a series' label gets that series' colour beside it.
   */
  headings: readonly string[];
  /** How a mark on the value axis is written: "$250K". */
  formatTick: (value: number) => string;
  /** The values are counts, so the axis is marked in whole numbers. */
  whole?: boolean;
  /** The height of the plot, as a Tailwind class. */
  heightClass?: string;
};

// How wide the figures of a column open beside it.
const FIGURES_WIDTH = "14rem";

// Under a column narrower than this a label of three letters would touch the next one.
// In pixels, as the labels are set in. Each column is told its own width (a container),
// so this holds however many columns there are and however wide the chart is.
const SPARED_WHEN_NARROW = "@max-[25px]:invisible";

/** The bars of one column: each stack of series, or each series on its own, bottom first. */
function barsOf(series: readonly ChartSeries[]): ChartSeries[][] {
  const bars = new Map<string, ChartSeries[]>();
  for (const item of series) {
    const key = item.stack ?? `series:${item.key}`;
    bars.set(key, [...(bars.get(key) ?? []), item]);
  }
  return [...bars.values()];
}

/**
 * A bar chart of a few series over a run of points, such as months.
 *
 * The value axis starts at zero, so a bar's length is in proportion to its figure. The
 * chart is laid out by the browser like any other content: it measures nothing, and so
 * fits whatever room it is given, at once. Pointing at a column, or stepping through the
 * columns with the arrow keys, shows its figures in words. The same figures are in a
 * table for assistive technology, which is told nothing about the drawing.
 */
export function BarChart({
  label,
  series,
  points,
  headings,
  formatTick,
  whole = false,
  heightClass = "h-56",
}: BarChartProps) {
  const [active, setActive] = useState<number | null>(null);
  const bars = barsOf(series);
  const tallest = Math.max(
    0,
    ...points.flatMap((point) =>
      bars.map((bar) => bar.reduce((sum, item) => sum + (point.values[item.key] ?? 0), 0)),
    ),
  );
  const ticks = axisTicks(tallest, { whole });
  const top = ticks[ticks.length - 1]!;
  const shown = active === null ? null : points[active];
  const swatches = new Map(series.map((item) => [item.label, item]));
  // The figures open beside their column, on the side with more room, and are kept
  // inside the plot where there is no room on either.
  const beside =
    active === null
      ? undefined
      : active < points.length / 2
        ? `calc(${((active + 1) / points.length) * 100}% + 0.5rem)`
        : `calc(${(active / points.length) * 100}% - ${FIGURES_WIDTH} - 0.5rem)`;

  function onKeyDown(event: React.KeyboardEvent) {
    const last = points.length - 1;
    const next =
      event.key === "ArrowRight"
        ? Math.min((active ?? -1) + 1, last)
        : event.key === "ArrowLeft"
          ? Math.max((active ?? points.length) - 1, 0)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : undefined;
    if (next !== undefined) {
      event.preventDefault();
      setActive(next);
    } else if (event.key === "Escape") {
      setActive(null);
    }
  }

  return (
    <figure>
      <div className={cn("flex", heightClass)}>
        <div aria-hidden="true" className="relative w-12 shrink-0">
          {ticks.map((tick) => (
            <span
              key={tick}
              className="absolute right-2.5 translate-y-1/2 text-[11px] leading-none text-ink-muted tabular-nums"
              style={{ bottom: `${percentOf(tick, top)}%` }}
            >
              {formatTick(tick)}
            </span>
          ))}
        </div>

        <div
          role="img"
          aria-label={`${label}. The figures are in the table that follows.`}
          tabIndex={0}
          onKeyDown={onKeyDown}
          // Reached with the keyboard, it starts on the latest point.
          onFocus={() => setActive((current) => current ?? points.length - 1)}
          onBlur={() => setActive(null)}
          // A finger lifting is not the pointer leaving: the figures stay until a tap elsewhere.
          onPointerLeave={(event) => event.pointerType === "mouse" && setActive(null)}
          className="relative min-w-0 flex-1 rounded-xs outline-offset-4"
        >
          {ticks.map((tick) => (
            <span
              key={tick}
              className={cn(
                "absolute inset-x-0 border-t",
                tick === 0 ? "border-line-strong" : "border-line",
              )}
              style={{ bottom: `${percentOf(tick, top)}%` }}
            />
          ))}

          <div className="absolute inset-0 flex">
            {points.map((point, index) => (
              <div
                key={point.key}
                data-point={point.key}
                onPointerEnter={() => setActive(index)}
                className={cn(
                  "flex min-w-0 flex-1 items-end justify-center gap-[3px] rounded-t-xs px-[3px] transition-colors",
                  active === index && "bg-sunken",
                )}
              >
                {bars.map((bar) => {
                  const total = bar.reduce((sum, item) => sum + (point.values[item.key] ?? 0), 0);
                  return (
                    <div
                      key={bar[0]!.key}
                      className="flex max-w-5 min-w-0 flex-1 flex-col-reverse"
                      style={{ height: `${percentOf(total, top)}%` }}
                    >
                      {bar.map((item) => (
                        <div
                          key={item.key}
                          data-series={item.key}
                          className={cn(
                            "min-h-0 last:rounded-t-[1px]",
                            point.partial ? HATCHED[item.tone] : SOLID[item.tone],
                          )}
                          style={{ flexGrow: point.values[item.key] ?? 0, flexBasis: 0 }}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {shown ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute top-1 z-20 rounded-md border border-line bg-surface px-3 py-2.5 text-[13px] shadow-overlay"
              style={{
                width: FIGURES_WIDTH,
                left: `clamp(0px, ${beside}, calc(100% - ${FIGURES_WIDTH}))`,
              }}
            >
              <p className="font-medium text-ink">{shown.title}</p>
              <dl className="mt-1.5 space-y-1">
                {shown.cells.map((cell, index) => {
                  const heading = headings[index + 1]!;
                  const swatch = swatches.get(heading);
                  // The figures that are drawn come first. What follows from them is set
                  // apart under a rule.
                  const derived = !swatch && swatches.has(headings[index] ?? "");
                  return (
                    <div
                      key={heading}
                      className={cn(
                        "flex items-baseline justify-between gap-4",
                        derived && "mt-1.5 border-t border-line pt-1.5",
                      )}
                    >
                      <dt className="flex items-center gap-1.5 text-ink-muted">
                        {swatch ? <Swatch tone={swatch.tone} hatched={shown.partial} /> : null}
                        {heading}
                      </dt>
                      <dd
                        className={cn("tabular-nums", cell.critical ? "text-critical" : "text-ink")}
                      >
                        {cell.text}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </div>
          ) : null}
        </div>
      </div>

      <div aria-hidden="true" className="flex pt-2 pl-12">
        {points.map((point, index) => (
          // A label wider than its column spills evenly to both sides rather than be cut.
          <div
            key={point.key}
            className={cn(
              "@container flex min-w-0 flex-1 flex-col items-center text-[11px] leading-4 whitespace-nowrap",
              active === index ? "font-medium text-ink" : "text-ink-muted",
            )}
          >
            {/* Where the columns are too narrow for a label each, every other label is
                left out, counting back from the last: the latest point keeps its name. */}
            <span className={cn((points.length - 1 - index) % 2 === 1 && SPARED_WHEN_NARROW)}>
              {point.label}
            </span>
            {point.detail ? (
              <span className="font-normal text-ink-muted">{point.detail}</span>
            ) : null}
          </div>
        ))}
      </div>

      {/* The wrapper is what hides it. A table is as wide as what is in it, whatever
          width it is given, and one left off-screen would make a phone scroll sideways. */}
      <div className="sr-only">
        <table>
          <caption>{label}</caption>
          <thead>
            <tr>
              {headings.map((heading) => (
                <th key={heading} scope="col">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.key}>
                <th scope="row">{point.title}</th>
                {point.cells.map((cell, index) => (
                  <td key={headings[index + 1]}>{cell.text}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

function Swatch({ tone, hatched = false }: { tone: ChartTone; hatched?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn("size-2.5 shrink-0 rounded-[2px]", hatched ? HATCHED[tone] : SOLID[tone])}
    />
  );
}

type ChartLegendProps = {
  series: readonly ChartSeries[];
  /** What hatching means in this chart, if any of it is hatched: "Month to date". */
  partial?: string;
  className?: string;
};

/** What each colour in a chart stands for, in a line. */
export function ChartLegend({ series, partial, className }: ChartLegendProps) {
  return (
    <ul
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted",
        className,
      )}
    >
      {series.map((item) => (
        <li key={item.key} className="flex items-center gap-1.5">
          <Swatch tone={item.tone} />
          {item.label}
        </li>
      ))}
      {partial ? (
        <li className="flex items-center gap-1.5">
          <Swatch tone="graphite" hatched />
          {partial}
        </li>
      ) : null}
    </ul>
  );
}
