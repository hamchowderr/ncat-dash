"use client";

import { type FitViewOptions, useReactFlow } from "@xyflow/react";
import { Maximize, Minus, Plus } from "lucide-react";
import { type ReactNode, type RefObject, useEffect } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The strip along the top of a canvas. Everything that used to float over the canvas
 * (adding steps and notes, the live run, zooming) sits here instead, so nothing is ever
 * drawn on top of a step and the canvas below is all canvas.
 */
export function CanvasBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      data-canvas-bar
      className={cn(
        "@container flex min-h-11 shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 px-2 py-1.5",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Zoom out, zoom in and fit, with room for more view buttons after them. */
export function CanvasZoom({
  fitViewOptions,
  children,
}: {
  fitViewOptions?: FitViewOptions;
  children?: ReactNode;
}) {
  const flow = useReactFlow();
  return (
    <div role="group" aria-label="View" className="ml-auto flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon-sm"
        title="Zoom out"
        onClick={() => void flow.zoomOut({ duration: 200 })}
      >
        <Minus />
        <span className="sr-only">Zoom out</span>
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        title="Zoom in"
        onClick={() => void flow.zoomIn({ duration: 200 })}
      >
        <Plus />
        <span className="sr-only">Zoom in</span>
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        title="Fit to screen"
        onClick={() => void flow.fitView({ ...fitViewOptions, duration: 250 })}
      >
        <Maximize />
        <span className="sr-only">Fit to screen</span>
      </Button>
      {children}
    </div>
  );
}

/**
 * Fits the steps to the canvas again whenever the canvas changes size, as when a side
 * panel opens beside it or the window is resized, so no step is left cut off at an edge.
 * Rendered inside the canvas's ReactFlowProvider.
 */
export function FitOnResize({
  canvasRef,
  fitViewOptions,
}: {
  canvasRef: RefObject<HTMLElement | null>;
  fitViewOptions?: FitViewOptions;
}) {
  const flow = useReactFlow();
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === "undefined") return;
    let first = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const watch = new ResizeObserver(() => {
      if (first) {
        first = false;
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(() => void flow.fitView({ ...fitViewOptions, duration: 200 }), 120);
    });
    watch.observe(canvas);
    return () => {
      clearTimeout(timer);
      watch.disconnect();
    };
  }, [canvasRef, flow, fitViewOptions]);
  return null;
}
