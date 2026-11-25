"use client";

import { CircleAlert, Info } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useActionState, useRef } from "react";

import type { SignInFailure } from "@/auth";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

import { signInAction } from "./actions";
import { DEMO_ACCOUNTS, DEMO_MODE, DEMO_PASSWORD } from "./demo-accounts";
import { SIGN_IN_MESSAGES } from "./sign-in";

/**
 * What the URL says about how the visitor got here: where to go after signing in, whether
 * their session ended, or whether Auth.js refused a sign-in and redirected back.
 *
 * Reading the URL can only happen in the browser, so this part is deferred. Keeping it
 * separate lets the form fields themselves be part of the prerendered page.
 */
function UrlNotices({ hidden }: { hidden: boolean }) {
  const searchParams = useSearchParams();
  const code = searchParams.get("code") as SignInFailure | null;
  const error =
    code && code in SIGN_IN_MESSAGES
      ? SIGN_IN_MESSAGES[code]
      : searchParams.has("error")
        ? SIGN_IN_MESSAGES.invalid_credentials
        : undefined;
  const sessionEnded = !error && searchParams.get("reason") === "session_ended";

  return (
    <>
      <input type="hidden" name="next" value={searchParams.get("next") ?? ""} />
      {hidden ? null : sessionEnded ? (
        <p className="flex items-start gap-2 rounded-sm bg-info-soft px-3 py-2.5 text-[13px] text-info">
          <Info className="mt-0.5 size-4 shrink-0" />
          Your session ended. Sign in again to continue.
        </p>
      ) : error ? (
        <ErrorNotice message={error} />
      ) : null}
    </>
  );
}

function ErrorNotice({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-sm bg-critical-soft px-3 py-2.5 text-[13px] text-critical"
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0" />
      {message}
    </p>
  );
}

export function LoginForm() {
  const [state, formAction, pending] = useActionState(signInAction, undefined);
  const email = useRef<HTMLInputElement>(null);
  const password = useRef<HTMLInputElement>(null);

  function fill(account: string) {
    if (email.current) email.current.value = account;
    if (password.current) password.current.value = DEMO_PASSWORD;
    password.current?.focus();
  }

  return (
    <>
      <form action={formAction} className="space-y-4">
        {/* The result of this attempt takes precedence over anything the URL says. */}
        {state?.error ? <ErrorNotice message={state.error} /> : null}
        <Suspense fallback={null}>
          <UrlNotices hidden={Boolean(state?.error)} />
        </Suspense>

        <Field id="email" label="Work email">
          {(control) => (
            <Input
              {...control}
              ref={email}
              name="email"
              type="email"
              autoComplete="username"
              defaultValue={state?.email}
              required
              autoFocus
            />
          )}
        </Field>
        <Field id="password" label="Password">
          {(control) => (
            <Input
              {...control}
              ref={password}
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          )}
        </Field>

        <Button type="submit" variant="primary" className="w-full" loading={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      {DEMO_MODE ? (
        <div className="mt-8 border-t border-line pt-6">
          <p className="eyebrow">Demo accounts</p>
          <p className="mt-1 text-[13px] text-ink-muted">
            Seeded sample data. Choose an account to fill in the form.
          </p>
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-md border border-line bg-surface">
            {DEMO_ACCOUNTS.map((account) => (
              <li key={account.email}>
                <button
                  type="button"
                  onClick={() => fill(account.email)}
                  className="flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2 text-left text-[13px] transition-colors hover:bg-canvas/70"
                >
                  <span className="font-medium text-ink">{account.name}</span>
                  <span className="text-xs text-ink-muted">{account.access}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}
