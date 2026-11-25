"use client";

import { ChevronRight, Menu } from "lucide-react";
import { usePathname } from "next/navigation";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useEffect, useState } from "react";

import { breadcrumbsFor } from "@/lib/navigation";

import { OrgSwitcher } from "./org-switcher";
import { SidebarContent } from "./sidebar";
import { UserMenu } from "./user-menu";

function Breadcrumbs() {
  const trail = breadcrumbsFor(usePathname());
  if (trail.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex items-center gap-1.5 text-[13px]">
        {trail.map((label, index) => {
          const current = index === trail.length - 1;
          return (
            <li key={label} className="flex min-w-0 items-center gap-1.5">
              {index > 0 ? (
                <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-ink-subtle" />
              ) : null}
              <span
                aria-current={current ? "page" : undefined}
                className={
                  current ? "truncate font-medium text-ink" : "hidden text-ink-muted sm:inline"
                }
              >
                {label}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** The frame around every signed-in page: navigation, header and the content column. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // The shell arrives as HTML before it is interactive. End-to-end tests wait for this
  // marker rather than guessing when clicks will start to work.
  useEffect(() => {
    document.documentElement.dataset.appReady = "true";
    return () => {
      delete document.documentElement.dataset.appReady;
    };
  }, []);

  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only z-[60] rounded-sm bg-surface px-3 py-2 text-sm font-medium text-ink shadow-overlay focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 hidden w-60 lg:block">
        <SidebarContent />
      </aside>

      <DialogPrimitive.Root open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 animate-overlay-in bg-ink/45 lg:hidden" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className="fixed inset-y-0 left-0 z-50 w-64 animate-slide-in-left focus:outline-none lg:hidden"
          >
            <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
            <SidebarContent onNavigate={() => setMobileNavOpen(false)} />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <div className="flex min-h-dvh flex-col lg:pl-60">
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-canvas/85 px-4 backdrop-blur-sm sm:px-6 lg:px-8">
          <button
            type="button"
            aria-label="Open navigation"
            onClick={() => setMobileNavOpen(true)}
            className="-ml-1.5 flex size-8 cursor-pointer items-center justify-center rounded-sm text-ink-muted hover:bg-sunken hover:text-ink lg:hidden"
          >
            <Menu className="size-5" />
          </button>
          <Breadcrumbs />
          <div className="ml-auto flex items-center gap-3">
            <OrgSwitcher />
            <UserMenu />
          </div>
        </header>

        <main id="main" className="flex-1 px-4 py-7 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
