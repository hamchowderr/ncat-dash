"use client";

import { ChevronLeft, ChevronRight, Folder, MoreVertical } from "lucide-react";
import Link from "next/link";
import { Children, Fragment, type ReactNode, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { PickList } from "./pick-list";

/**
 * A list of items as soft rounded rows, the way an automation tool lists its workflows:
 * a name with a line of facts under it, badges and a menu on the right, folders first,
 * and pages at the bottom.
 */
export function ItemList({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <ul aria-label={label} data-item-list className={cn("reveal flex flex-col gap-2", className)}>
      {children}
    </ul>
  );
}

/** Facts in a row, each set apart by a short upright rule. */
export function MetaLine({ children, className }: { children: ReactNode; className?: string }) {
  const parts = Children.toArray(children).filter(Boolean);
  if (parts.length === 0) return null;
  return (
    <div
      className={cn(
        "text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.8125rem] leading-5",
        className,
      )}
    >
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 && <span aria-hidden="true" className="bg-border h-3 w-px shrink-0" />}
          <span className="min-w-0">{part}</span>
        </Fragment>
      ))}
    </div>
  );
}

/**
 * One row. The name opens the item: a link with `href`, a button with `onOpen`. The whole
 * row answers a click on the name; the badges and menu stay their own controls.
 */
export function ItemRow({
  name,
  href,
  onOpen,
  openLabel,
  icon,
  leading,
  meta,
  badges,
  menu,
  menuLabel,
  selected,
  className,
  ...data
}: {
  name: ReactNode;
  href?: string;
  onOpen?: () => void;
  /** What a screen reader hears for the name, when it should say more than the name. */
  openLabel?: string;
  icon?: ReactNode;
  /** Something before the name that is its own control, such as a box to tick. */
  leading?: ReactNode;
  meta?: ReactNode;
  badges?: ReactNode;
  /** Menu items; a ⋮ button opens them. */
  menu?: ReactNode;
  menuLabel?: string;
  selected?: boolean;
  className?: string;
} & { [key: `data-${string}`]: string | undefined }) {
  const stretch =
    "text-left font-medium outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-3 focus-visible:after:ring-ring/50";
  return (
    <li
      {...data}
      className={cn(
        "group/row bg-surface hover:bg-muted relative flex min-h-16 flex-wrap items-center gap-x-3 gap-y-2 rounded-xl px-4 py-3 transition-colors",
        selected && "row-selected",
        className,
      )}
    >
      {leading && <div className="relative z-10 flex shrink-0 items-center">{leading}</div>}
      {icon && (
        <div className="text-muted-foreground flex shrink-0 items-center [&>svg]:size-6">
          {icon}
        </div>
      )}
      <div className="flex min-w-0 flex-1 basis-56 flex-col gap-0.5">
        {href ? (
          <Link
            href={href}
            transitionTypes={["nav-forward"]}
            aria-label={openLabel}
            className={cn(stretch, "truncate")}
          >
            {name}
          </Link>
        ) : onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            aria-label={openLabel}
            className={cn(stretch, "truncate")}
          >
            {name}
          </button>
        ) : (
          <span className="truncate font-medium">{name}</span>
        )}
        {meta}
      </div>
      {(badges || menu) && (
        <div className="relative z-10 ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
          {badges}
          {menu && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="text-muted-foreground">
                  <MoreVertical />
                  <span className="sr-only">{menuLabel ?? "More"}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">{menu}</DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}
    </li>
  );
}

/** A folder at the top of a list, opening onto what is in it. */
export function FolderRow(props: Omit<Parameters<typeof ItemRow>[0], "icon">) {
  return (
    <ItemRow {...props} data-folder="" icon={<Folder strokeWidth={1.5} aria-hidden="true" />} />
  );
}

const DOTS = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-destructive",
  grey: "bg-muted-foreground/50",
} as const;

/** A small soft chip on the right of a row: a count with its icon, or a state with a dot. */
export function ItemBadge({
  dot,
  children,
  title,
  className,
}: {
  dot?: keyof typeof DOTS;
  children: ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "bg-background text-foreground inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium whitespace-nowrap shadow-xs [&>svg]:size-3.5",
        className,
      )}
    >
      {dot && <span aria-hidden="true" className={cn("size-2 rounded-full", DOTS[dot])} />}
      {children}
    </span>
  );
}

export const PER_PAGE = [10, 25, 50, 100] as const;

function storedPerPage(key: string): number | null {
  try {
    const value = Number(window.localStorage.getItem(`per-page:${key}`));
    return (PER_PAGE as readonly number[]).includes(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Splits a list into pages. How many go on a page is remembered per list on this
 * computer; going past the end (when items go away) falls back to the last page.
 */
export function usePages<T>(items: readonly T[], key: string, initial = 25) {
  // Lists only fill in the browser, so reading the stored choice up front changes nothing
  // the server drew.
  const [perPage, setPerPageState] = useState(() =>
    typeof window === "undefined" ? initial : (storedPerPage(key) ?? initial),
  );
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  const current = Math.min(page, pages);
  const shown = useMemo(
    () => items.slice((current - 1) * perPage, current * perPage),
    [items, current, perPage],
  );
  function setPerPage(next: number) {
    setPerPageState(next);
    setPage(1);
    try {
      window.localStorage.setItem(`per-page:${key}`, String(next));
    } catch {
      // Only a convenience: the list still works without it.
    }
  }
  return {
    shown,
    pager: {
      total: items.length,
      page: current,
      pages,
      perPage,
      onPage: setPage,
      onPerPage: setPerPage,
    },
  };
}

/** The page numbers to show: all of them when few, else the ends and those around this one. */
export function pageNumbers(page: number, pages: number): (number | "gap")[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, n) => n + 1);
  const wanted = new Set([1, pages, page - 1, page, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((n) => wanted.add(n));
  if (page >= pages - 2) [pages - 3, pages - 2, pages - 1].forEach((n) => wanted.add(n));
  const sorted = [...wanted].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  sorted.forEach((n, index) => {
    if (index > 0 && n - sorted[index - 1] > 1) out.push("gap");
    out.push(n);
  });
  return out;
}

/** "Total 56", the pages, and how many go on a page, at the foot of a list. */
export function Pager({
  total,
  page,
  pages,
  perPage,
  onPage,
  onPerPage,
  noun = "items",
}: ReturnType<typeof usePages>["pager"] & { noun?: string }) {
  if (total <= PER_PAGE[0]) return null;
  return (
    <nav
      aria-label={`Pages of ${noun}`}
      className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2"
    >
      <span className="text-muted-foreground text-sm tabular-nums">Total {total}</span>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft />
        </Button>
        {pageNumbers(page, pages).map((n, index) =>
          n === "gap" ? (
            <span key={`gap-${index}`} aria-hidden="true" className="text-muted-foreground px-1">
              …
            </span>
          ) : (
            <Button
              key={n}
              variant="ghost"
              size="icon-sm"
              aria-label={`Page ${n}`}
              aria-current={n === page ? "page" : undefined}
              onClick={() => onPage(n)}
              className={cn("tabular-nums", n === page && "bg-muted text-foreground font-semibold")}
            >
              {n}
            </Button>
          ),
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          aria-label="Next page"
        >
          <ChevronRight />
        </Button>
      </div>
      <PickList
        aria-label={`How many ${noun} on a page`}
        size="sm"
        className="w-28"
        value={String(perPage)}
        onChange={(next) => onPerPage(Number(next))}
        options={PER_PAGE.map((n) => ({ value: String(n), label: `${n}/page` }))}
      />
    </nav>
  );
}
