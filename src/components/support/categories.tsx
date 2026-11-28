"use client";

import {
  categoryTitle,
  SUPPORT_CATEGORIES,
  SUPPORT_VIA,
  type SupportCategory,
} from "@convex/lib/supportCategories";
import {
  Bot,
  CircleHelp,
  CreditCard,
  Film,
  FolderUp,
  Lightbulb,
  type LucideIcon,
  Plug,
  Users,
  Workflow,
} from "lucide-react";

import { cn } from "@/lib/utils";

export const CATEGORY_ICONS: Record<SupportCategory, LucideIcon> = {
  automations: Workflow,
  results: Film,
  files: FolderUp,
  connections: Plug,
  account: Users,
  billing: CreditCard,
  idea: Lightbulb,
  other: CircleHelp,
};

/**
 * What the request is about, as a grid of choices with a line each, the way Help
 * Scout's and Intercom's forms ask for a reason. Arrow keys move between them.
 */
export function CategoryPicker({
  value,
  onChange,
}: {
  value: SupportCategory | null;
  onChange: (value: SupportCategory) => void;
}) {
  const move = (from: number, by: number) => {
    const next =
      SUPPORT_CATEGORIES[(from + by + SUPPORT_CATEGORIES.length) % SUPPORT_CATEGORIES.length];
    onChange(next.id);
    document.getElementById(`help-category-${next.id}`)?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label="What do you need help with?"
      className="grid gap-1.5 sm:grid-cols-2"
    >
      {SUPPORT_CATEGORIES.map((category, index) => {
        const Icon = CATEGORY_ICONS[category.id];
        const picked = value === category.id;
        // One stop in the tab order: the picked one, or the first while none is.
        const tabbable = picked || (value === null && index === 0);
        return (
          <button
            key={category.id}
            id={`help-category-${category.id}`}
            type="button"
            role="radio"
            aria-checked={picked}
            tabIndex={tabbable ? 0 : -1}
            onClick={() => onChange(category.id)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowRight") {
                event.preventDefault();
                move(index, 1);
              } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
                event.preventDefault();
                move(index, -1);
              }
            }}
            className={cn(
              "focus-visible:ring-ring/50 flex items-start gap-3 rounded-xl px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-3",
              picked ? "row-selected" : "bg-surface hover:bg-muted",
            )}
          >
            <Icon
              className={cn(
                "mt-0.5 size-4 shrink-0",
                picked ? "text-foreground" : "text-muted-foreground",
              )}
              aria-hidden="true"
            />
            <span className="grid min-w-0 gap-0.5">
              <span className="text-sm font-medium">{category.title}</span>
              <span className="text-muted-foreground text-xs leading-snug font-normal">
                {category.hint}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** A request's category in a list or header: its icon and name, quietly. */
export function CategoryLabel({
  category,
  className,
}: {
  category: string | null;
  className?: string;
}) {
  const title = categoryTitle(category);
  if (!title) return null;
  const Icon = CATEGORY_ICONS[category as SupportCategory];
  return (
    <span
      className={cn("text-muted-foreground inline-flex min-w-0 items-center gap-1", className)}
      data-category={category}
    >
      <Icon className="size-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{title}</span>
    </span>
  );
}

/** "Opened by the assistant in chat", when someone other than the form opened it. */
export function ViaLabel({ via, className }: { via: string | null; className?: string }) {
  const words = via ? SUPPORT_VIA[via as keyof typeof SUPPORT_VIA] : undefined;
  if (!words) return null;
  return (
    <span className={cn("text-muted-foreground inline-flex items-center gap-1", className)}>
      <Bot className="size-3 shrink-0" aria-hidden="true" />
      {words}
    </span>
  );
}
