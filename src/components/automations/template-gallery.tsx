"use client";

import {
  type Starter,
  STARTER_CATEGORIES,
  type StarterCategory,
  STARTERS,
} from "@ncat-dash/automation-core";
import { Plus, Search } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { FlowStrip } from "./flow-strip";

const card =
  "hover:bg-muted focus-visible:ring-ring/50 flex flex-col gap-3 rounded-xl bg-surface p-4 text-left outline-none transition-colors focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-60";

export function TemplateCard({
  starter,
  disabled,
  onPick,
}: {
  starter: Starter;
  disabled: boolean;
  onPick: () => void;
}) {
  return (
    <button type="button" className={card} disabled={disabled} onClick={onPick}>
      <FlowStrip
        trigger={starter.trigger}
        nodes={starter.nodes}
        edges={starter.edges}
        className="bg-muted/40 min-h-16 w-full justify-center overflow-hidden rounded-lg px-3 py-3"
      />
      <span className="grid gap-0.5">
        <span className="text-sm font-medium">{starter.name}</span>
        <span className="text-muted-foreground line-clamp-2 text-sm">{starter.description}</span>
      </span>
    </button>
  );
}

const chip =
  "focus-visible:ring-ring/50 rounded-full px-3 py-1.5 text-sm outline-none transition-colors focus-visible:ring-3";

/**
 * Every ready-made automation, sorted by what it is for. Nothing is left out: "All"
 * shows each category in turn, and a category or a search narrows the same list.
 * Picking one makes it and opens it on the canvas.
 */
export function TemplateGallery({
  disabled = false,
  onPick,
}: {
  disabled?: boolean;
  onPick: (starter: Starter | null) => void;
}) {
  const [category, setCategory] = useState<StarterCategory | "all">("all");
  const [query, setQuery] = useState("");
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (starter: Starter) => {
    const text = `${starter.name} ${starter.description}`.toLowerCase();
    return words.every((word) => text.includes(word));
  };
  // Several-step workflows first, then single steps, within each category.
  const ordered = [...STARTERS].sort(
    (a, b) => Number(a.group === "recipe") - Number(b.group === "recipe"),
  );
  const shown = STARTER_CATEGORIES.filter((c) => category === "all" || c.id === category)
    .map((c) => ({
      ...c,
      starters: ordered.filter((starter) => starter.category === c.id && matches(starter)),
    }))
    .filter((c) => c.starters.length > 0);

  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:max-w-sm">
            <Search
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <Input
              type="search"
              aria-label="Find a ready-made automation"
              placeholder="Search, such as podcast"
              className="pl-8"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            className="ml-auto"
            disabled={disabled}
            onClick={() => onPick(null)}
          >
            <Plus />
            Empty canvas
          </Button>
        </div>
        <div role="group" aria-label="Category" className="flex flex-wrap gap-1.5">
          {[{ id: "all" as const, label: "All" }, ...STARTER_CATEGORIES].map((c) => {
            const count =
              c.id === "all"
                ? STARTERS.length
                : STARTERS.filter((starter) => starter.category === c.id).length;
            const on = category === c.id;
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={on}
                className={cn(
                  chip,
                  on ? "bg-foreground text-background" : "bg-surface hover:bg-muted",
                )}
                onClick={() => setCategory(c.id)}
              >
                {c.label}{" "}
                <span className={on ? "opacity-70" : "text-muted-foreground"}>{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nothing ready-made matches that. Start from an empty canvas, or ask the agent to build it.
        </p>
      ) : (
        shown.map((c) => (
          <section key={c.id} className="reveal grid gap-3" aria-labelledby={`starters-${c.id}`}>
            <h3 id={`starters-${c.id}`} className="text-sm font-medium">
              {c.label} <span className="text-muted-foreground">{c.starters.length}</span>
            </h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {c.starters.map((starter) => (
                <TemplateCard
                  key={starter.id}
                  starter={starter}
                  disabled={disabled}
                  onPick={() => onPick(starter)}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
