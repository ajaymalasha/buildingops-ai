"use client";

import { Building2, ChevronsUpDown, Globe } from "lucide-react";
import Link from "next/link";
import { useTransition } from "react";
import { toast } from "sonner";

import { useMe } from "@/components/me-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { switchOrganizationAction } from "@/features/auth/actions";
import { hardNavigate } from "@/lib/hard-navigation";
import { ROLE_LABELS } from "@/lib/permissions";

/** Shows the active organization and lets people who belong to several change it. */
export function OrgSwitcher() {
  const me = useMe();
  const [pending, startTransition] = useTransition();

  const activeId = me.organization?.id;
  const canSwitch = me.memberships.length > 1 || me.user.is_platform_admin;

  function switchTo(organizationId: string) {
    if (organizationId === activeId) return;
    startTransition(async () => {
      const result = await switchOrganizationAction(organizationId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      hardNavigate("/");
    });
  }

  const label = (
    <>
      <Building2 className="size-4 shrink-0 text-ink-subtle" />
      <span className="max-w-44 truncate font-medium">
        {me.organization?.name ?? "No organization"}
      </span>
    </>
  );

  if (!canSwitch) {
    return <div className="flex h-8 items-center gap-2 px-2 text-[13px] text-ink">{label}</div>;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Switch organization"
        disabled={pending}
        className="flex h-8 cursor-pointer items-center gap-2 rounded-sm border border-line-strong bg-surface px-2.5 text-[13px] text-ink shadow-raised transition-colors hover:bg-sunken disabled:opacity-60"
      >
        {label}
        {pending ? (
          <Spinner className="text-ink-subtle" />
        ) : (
          <ChevronsUpDown className="size-3.5 text-ink-subtle" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {me.memberships.length > 0 ? (
          <DropdownMenuLabel>Your organizations</DropdownMenuLabel>
        ) : null}
        {me.memberships.map(({ organization, role }) => (
          <DropdownMenuItem
            key={organization.id}
            selected={organization.id === activeId}
            onSelect={() => switchTo(organization.id)}
          >
            <span className="min-w-0">
              <span className="block truncate font-medium">{organization.name}</span>
              <span className="block text-xs text-ink-muted">{ROLE_LABELS[role]}</span>
            </span>
          </DropdownMenuItem>
        ))}
        {me.user.is_platform_admin ? (
          <>
            {me.memberships.length > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem asChild>
              <Link href="/platform/organizations">
                <Globe />
                All organizations
              </Link>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
