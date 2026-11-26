"use client";

import { Check, Ellipsis } from "lucide-react";
import { DropdownMenu as MenuPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;
export const DropdownMenuGroup = MenuPrimitive.Group;

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-48 animate-pop-in rounded-md border border-line bg-surface p-1 shadow-overlay focus:outline-none",
          className,
        )}
        {...props}
      />
    </MenuPrimitive.Portal>
  );
}

type ItemProps = React.ComponentProps<typeof MenuPrimitive.Item> & {
  tone?: "default" | "danger";
  /** Marks the current choice in a list of options. */
  selected?: boolean;
};

export function DropdownMenuItem({
  className,
  tone = "default",
  selected,
  asChild,
  children,
  ...props
}: ItemProps) {
  return (
    <MenuPrimitive.Item
      asChild={asChild}
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-xs px-2 py-1.5 text-[13px] outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-sunken [&_svg]:size-4 [&_svg]:shrink-0",
        tone === "danger" ? "text-critical data-highlighted:bg-critical-soft" : "text-ink",
        className,
      )}
      {...props}
    >
      {/* With asChild the single child element becomes the item, so nothing may sit beside it. */}
      {asChild ? (
        children
      ) : (
        <>
          {children}
          {selected ? <Check className="ml-auto text-brand-600" /> : null}
        </>
      )}
    </MenuPrimitive.Item>
  );
}

export function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Label>) {
  return <MenuPrimitive.Label className={cn("px-2 pt-1.5 pb-1 eyebrow", className)} {...props} />;
}

export function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Separator>) {
  return (
    <MenuPrimitive.Separator className={cn("-mx-1 my-1 h-px bg-line", className)} {...props} />
  );
}

type RowActionsProps = {
  /** Names the row for people who cannot see which one the button sits in. */
  label: string;
  /** The menu's items. */
  children: React.ReactNode;
};

/** The menu at the end of a table row, behind a "more" button. */
export function RowActions({ label, children }: RowActionsProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={label}
        className="inline-flex size-7 cursor-pointer items-center justify-center rounded-sm text-ink-subtle hover:bg-sunken hover:text-ink data-[state=open]:bg-sunken"
      >
        <Ellipsis className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}
