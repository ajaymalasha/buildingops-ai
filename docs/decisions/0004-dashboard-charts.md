# 0004. Dashboard charts: HTML and CSS, no charting library

## Context

The executive dashboard has two charts, both bars over twelve months: revenue beside
operating cost (the cost stacked from labor and expenses), and work orders opened beside
completed. It also has a few bars inside table rows. The dashboard is the first page a
manager sees after signing in.

Recharts 3 was the candidate library. It was tried in this app before deciding
(Recharts 3.11.1, React 19.3, Next.js 16.4 with Cache Components, a production build):

- **It works.** A stacked bar chart in a client component sized itself to its container
  on first render. While its page was one of the hidden routes the framework keeps
  mounted it measured nothing, and it measured again correctly when shown, at a phone's
  width too. The tooltip worked, and the console stayed clean.
- **It is large for what is drawn.** The JavaScript the Overview route loads (the page's
  own files, the layout's and the root's, not chunks loaded later), added up from the
  build's manifests:

  | Build | Uncompressed | Gzip |
  | --- | --- | --- |
  | Before the dashboard | 710.2 kB | 219.7 kB |
  | With one Recharts bar chart | 1,120.0 kB | 335.0 kB |
  | The finished dashboard, charts in HTML and CSS | 762.9 kB | 234.0 kB |

  Recharts added 409.8 kB (115.3 kB gzip), half as much again as the route loaded
  before, and 37 packages to the lockfile. The whole finished dashboard, charts
  included, adds 52.7 kB (14.3 kB gzip).

So the question was not whether Recharts works, which it does, but whether two bar charts
are worth that much of the first page's weight.

## Decision

The charts are drawn with HTML and CSS by one owned component,
`apps/web/src/components/ui/bar-chart.tsx`, and no charting library is added.

- A bar is a `div` whose height is a percentage of the plot. The value axis starts at
  zero and is marked at round values (`axisTicks` in `lib/chart.ts`), so a bar's length is
  in proportion to its figure. Stacked series are one bar divided in proportion.
- The browser lays the chart out like any other content. Nothing is measured, so it is
  drawn in the same paint as the figures around it, fits whatever width it is given, and
  needs no resize handling. Where its columns are narrower than a label, as twelve months
  are on a small phone, every other label is left out: each column is a container, and a
  container query on its own width does it.
- The figures of a column are shown beside it on hover, on tap and when the plot is
  stepped through with the arrow keys. The same figures are in a visually hidden table,
  and assistive technology is told the plot is an image that the table describes.
- Colours come from the design tokens. What is not final, such as the month still
  running, is hatched.

## Consequences

- The dashboard costs a first-time visitor about 14 kB of compressed JavaScript instead
  of about 130 kB, and there is no dependency to keep in step with React and Next.js.
- The component draws bars and nothing else. A line, an area or a scatter chart would be
  new work, and a chart with many series, zooming or animation would be the point at
  which to reconsider a library: the measurements above are the cost to weigh it against.
- Axis marks, tooltip placement and keyboard behaviour are ours to maintain. Because
  nothing is measured, the component tests can assert them directly: the height of each
  bar, the marks on the axis, which figures a column shows (`components/ui/ui.test.tsx`,
  `lib/lib.test.ts`).
- Numbers handed to the chart are for drawing only. The figures in its tooltip and its
  table are the API's decimal strings, formatted, never the numbers the bars were drawn
  from.
