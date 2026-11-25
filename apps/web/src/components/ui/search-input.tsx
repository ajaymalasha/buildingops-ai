"use client";

import { Search } from "lucide-react";
import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

type SearchInputProps = {
  /** The applied search text (from the URL). */
  value: string | undefined;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  className?: string;
};

const DEBOUNCE_MS = 250;

/** A search box that applies what was typed after a short pause. */
export function SearchInput({ value, onChange, label, placeholder, className }: SearchInputProps) {
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Follow outside changes (back/forward, "clear filters") without fighting the typist.
  useEffect(() => {
    if (input.current && document.activeElement !== input.current) {
      input.current.value = value ?? "";
    }
  }, [value]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <div className={cn("relative", className)}>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-subtle"
      />
      <input
        ref={input}
        type="search"
        aria-label={label}
        placeholder={placeholder ?? label}
        defaultValue={value ?? ""}
        onChange={(event) => {
          const next = event.target.value.trim();
          clearTimeout(timer.current);
          timer.current = setTimeout(() => onChange(next), DEBOUNCE_MS);
        }}
        className="h-9 w-full rounded-sm border border-line-strong bg-surface pr-3 pl-8 text-sm text-ink transition-colors placeholder:text-ink-subtle hover:border-ink-subtle focus-visible:border-brand-500 focus-visible:ring-3 focus-visible:ring-brand-500/20 focus-visible:outline-none [&::-webkit-search-cancel-button]:appearance-none"
      />
    </div>
  );
}
