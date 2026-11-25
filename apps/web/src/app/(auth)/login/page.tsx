import type { Metadata } from "next";

import { Wordmark } from "@/components/shell/logo";
import { LoginForm } from "@/features/auth/login-form";

export const metadata: Metadata = { title: "Sign in" };

const PRINCIPLES = [
  ["Isolated by design", "Each organization's records are separated in the database itself."],
  ["Every change on record", "An append-only audit trail of who did what, and when."],
  ["Access by role", "People see and change only what their role allows."],
] as const;

// Which windows are lit in the facade, as [row, column] pairs. Fixed, so the page renders
// the same on the server and in the browser.
const FACADE = { rows: 9, columns: 12 };
const LIT = new Set([
  "0-3",
  "0-8",
  "1-1",
  "1-5",
  "1-6",
  "1-10",
  "2-2",
  "2-7",
  "3-0",
  "3-4",
  "3-9",
  "3-11",
  "4-3",
  "4-6",
  "5-1",
  "5-8",
  "5-10",
  "6-2",
  "6-5",
  "6-7",
  "7-0",
  "7-4",
  "7-9",
  "8-6",
  "8-11",
]);

function Facade() {
  return (
    <div
      aria-hidden="true"
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(${FACADE.columns}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: FACADE.rows * FACADE.columns }, (_, index) => {
        const key = `${Math.floor(index / FACADE.columns)}-${index % FACADE.columns}`;
        const lit = LIT.has(key);
        return (
          <span
            key={key}
            className={
              lit
                ? "aspect-[4/5] rounded-[3px] bg-mint/80"
                : "aspect-[4/5] rounded-[3px] border border-white/10 bg-white/[0.03]"
            }
            style={lit ? { opacity: 0.35 + ((index * 37) % 60) / 100 } : undefined}
          />
        );
      })}
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <Wordmark surface="light" />
        <main className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">
            <h1 className="text-[26px] leading-8 font-semibold text-ink">Sign in</h1>
            <p className="mt-1.5 mb-7 text-ink-muted">
              Use the email your organization registered for you.
            </p>
            <LoginForm />
          </div>
        </main>
        <p className="text-xs text-ink-subtle">
          Access is managed by your organization&apos;s administrator.
        </p>
      </div>

      <aside className="relative hidden overflow-hidden bg-night blueprint text-night-ink lg:flex lg:flex-col lg:justify-between lg:p-14">
        <div className="max-w-md">
          <p className="text-[11px] font-semibold tracking-[0.14em] text-mint uppercase">
            Building operations
          </p>
          <h2 className="mt-4 text-[34px] leading-[1.12] font-semibold tracking-tight text-white">
            The system of record for the buildings you run.
          </h2>
        </div>

        <div className="mx-auto w-full max-w-md py-10">
          <Facade />
          <div className="mt-2 h-px bg-white/15" />
        </div>

        <dl className="grid max-w-xl grid-cols-3 gap-6">
          {PRINCIPLES.map(([title, detail]) => (
            <div key={title} className="border-t border-white/15 pt-4">
              <dt className="text-[13px] font-semibold text-white">{title}</dt>
              <dd className="mt-1 text-xs leading-[18px] text-night-muted">{detail}</dd>
            </div>
          ))}
        </dl>
      </aside>
    </div>
  );
}
