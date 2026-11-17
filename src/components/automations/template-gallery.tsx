"use client";

import { type Starter, STARTERS } from "@ncat-dash/automation-core";
import { Plus } from "lucide-react";

import { cn } from "@/lib/utils";

import { FlowStrip } from "./flow-strip";

const card =
  "bg-card hover:border-foreground/30 focus-visible:ring-ring/50 flex flex-col gap-3 rounded-xl border p-4 text-left outline-none transition-[border-color,box-shadow] hover:shadow-sm focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-60";

function TemplateCard({
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

/**
 * Ready-made automations, each drawn as its steps. Picking one makes it and opens it on
 * the canvas. `recipes` adds one automation per FFmpeg example from the toolkit.
 */
export function TemplateGallery({
  recipes = true,
  disabled = false,
  onPick,
}: {
  recipes?: boolean;
  disabled?: boolean;
  onPick: (starter: Starter | null) => void;
}) {
  const workflows = STARTERS.filter((starter) => starter.group === "workflow");
  const examples = STARTERS.filter((starter) => starter.group === "recipe");
  return (
    <div className="grid gap-6">
      <section className="grid gap-3">
        <h3 className="text-sm font-medium">Workflows</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {workflows.map((starter) => (
            <TemplateCard
              key={starter.id}
              starter={starter}
              disabled={disabled}
              onPick={() => onPick(starter)}
            />
          ))}
          <button
            type="button"
            className={cn(card, "border-dashed")}
            disabled={disabled}
            onClick={() => onPick(null)}
          >
            <span className="bg-muted/40 flex min-h-16 w-full items-center justify-center rounded-lg">
              <Plus className="text-muted-foreground size-5" aria-hidden="true" />
            </span>
            <span className="grid gap-0.5">
              <span className="text-sm font-medium">Empty canvas</span>
              <span className="text-muted-foreground text-sm">
                Start with a trigger and add your own steps.
              </span>
            </span>
          </button>
        </div>
      </section>
      {recipes && (
        <section className="grid gap-3">
          <div className="grid gap-0.5">
            <h3 className="text-sm font-medium">FFmpeg examples from the toolkit</h3>
            <p className="text-muted-foreground text-sm">
              Each example in the toolkit&apos;s Postman collection, as an automation you can
              extend.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {examples.map((starter) => (
              <TemplateCard
                key={starter.id}
                starter={starter}
                disabled={disabled}
                onPick={() => onPick(starter)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
