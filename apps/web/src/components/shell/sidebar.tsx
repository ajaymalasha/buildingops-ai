"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useMe } from "@/components/me-provider";
import { isActivePath, visibleNavigation } from "@/lib/navigation";
import { cn } from "@/lib/utils";

import { Wordmark } from "./logo";

/** The navigation column. Rendered in the fixed sidebar and in the mobile drawer. */
export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { permissions } = useMe();
  const sections = visibleNavigation(permissions);

  return (
    <div className="flex h-full flex-col bg-night text-night-ink">
      <div className="flex h-14 shrink-0 items-center px-5">
        <Link href="/" onClick={onNavigate} className="rounded-sm">
          <Wordmark />
        </Link>
      </div>

      <nav aria-label="Main" className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
        {sections.map((section, index) => (
          <div key={section.label ?? index}>
            {section.label ? (
              <p className="mb-1.5 px-2 text-[11px] font-semibold tracking-[0.07em] text-night-muted uppercase">
                {section.label}
              </p>
            ) : null}
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActivePath(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "relative flex h-8.5 items-center gap-2.5 rounded-sm px-2 text-[13.5px] font-medium transition-colors",
                        active
                          ? "bg-night-raised text-white"
                          : "text-night-muted hover:bg-night-raised/60 hover:text-night-ink",
                      )}
                    >
                      {active ? (
                        <span
                          aria-hidden="true"
                          className="absolute top-1.5 bottom-1.5 -left-3 w-0.75 rounded-r-full bg-mint"
                        />
                      ) : null}
                      <item.icon className={cn("size-4 shrink-0", active && "text-mint")} />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  );
}
