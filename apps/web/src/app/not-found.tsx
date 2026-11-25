import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <p className="eyebrow">404</p>
      <h1 className="mt-2 text-[22px] font-semibold text-ink">This page doesn&apos;t exist</h1>
      <p className="mt-1 max-w-sm text-ink-muted">
        The link may be out of date, or the page may have moved.
      </p>
      <Button asChild variant="primary" className="mt-6">
        <Link href="/">Back to overview</Link>
      </Button>
    </div>
  );
}
