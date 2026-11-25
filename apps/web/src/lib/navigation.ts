import {
  Building2,
  Globe,
  LayoutDashboard,
  ScrollText,
  Users,
  type LucideIcon,
} from "lucide-react";

import type { Permission } from "@/lib/permissions";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Hidden from people who lack this permission. */
  permission?: Permission;
};

export type NavSection = {
  label?: string;
  items: NavItem[];
};

/**
 * The application's navigation. A module is listed here once it works; nothing appears
 * as a placeholder.
 */
export const NAVIGATION: NavSection[] = [
  {
    items: [{ label: "Overview", href: "/", icon: LayoutDashboard }],
  },
  {
    label: "Administration",
    items: [
      { label: "Members", href: "/settings/members", icon: Users, permission: "members:read" },
      {
        label: "Organization",
        href: "/settings/organization",
        icon: Building2,
        permission: "organization:read",
      },
      {
        label: "Audit log",
        href: "/settings/audit-log",
        icon: ScrollText,
        permission: "audit:read",
      },
    ],
  },
  {
    label: "Platform",
    items: [
      {
        label: "Organizations",
        href: "/platform/organizations",
        icon: Globe,
        permission: "platform:organizations",
      },
    ],
  },
];

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function visibleNavigation(permissions: readonly Permission[]): NavSection[] {
  return NAVIGATION.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) => !item.permission || permissions.includes(item.permission),
    ),
  })).filter((section) => section.items.length > 0);
}

/** "Administration / Members" for the page at `pathname`, or the account page's own trail. */
export function breadcrumbsFor(pathname: string): string[] {
  for (const section of NAVIGATION) {
    for (const item of section.items) {
      if (isActivePath(pathname, item.href)) {
        return section.label ? [section.label, item.label] : [item.label];
      }
    }
  }
  if (pathname.startsWith("/settings/account")) return ["Account"];
  return [];
}
