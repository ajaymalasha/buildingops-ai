"use client";

import { LogOut, UserRound } from "lucide-react";
import Link from "next/link";
import { useTransition } from "react";

import { useMe } from "@/components/me-provider";
import { Avatar } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOutAction } from "@/features/auth/actions";
import { ROLE_LABELS } from "@/lib/permissions";

export function UserMenu() {
  const me = useMe();
  const [pending, startTransition] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account menu"
        className="cursor-pointer rounded-full ring-2 ring-transparent transition-shadow hover:ring-line-strong"
      >
        <Avatar name={me.user.full_name} className="size-8 text-xs" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <div className="px-2 py-2">
          <p className="truncate text-[13px] font-semibold text-ink">{me.user.full_name}</p>
          <p className="truncate text-xs text-ink-muted">{me.user.email}</p>
          {me.role ? <p className="mt-1 text-xs text-ink-subtle">{ROLE_LABELS[me.role]}</p> : null}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings/account">
            <UserRound />
            Account
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={pending}
          onSelect={(event) => {
            event.preventDefault(); // keep the menu open while the request runs
            startTransition(() => signOutAction());
          }}
        >
          <LogOut />
          {pending ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
