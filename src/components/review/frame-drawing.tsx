"use client";

import {
  arrowHead,
  DRAW_COLORS,
  type DrawColor,
  type DrawTool,
  type ReviewComment,
  type Shape,
  SHAPE_LIMIT,
  type Thread,
} from "@takewon/review-core";
import { ArrowUpRight, Check, Eraser, PenLine, Square, Undo2 } from "lucide-react";
import { type PointerEvent, type RefObject, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/** How far, as a share of the picture, the pen moves before a new point is kept. */
const STEP = 0.004;

const TOOLS: { tool: DrawTool; label: string; icon: typeof PenLine }[] = [
  { tool: "pen", label: "Pen", icon: PenLine },
  { tool: "arrow", label: "Arrow", icon: ArrowUpRight },
  { tool: "box", label: "Box", icon: Square },
];

const COLOR_NAMES: Record<DrawColor, string> = {
  red: "Red",
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  white: "White",
};

function ShapeMark({ shape, width, height }: { shape: Shape; width: number; height: number }) {
  const stroke = DRAW_COLORS[shape.color];
  const xs = shape.points.filter((_, at) => at % 2 === 0).map((x) => x * width);
  const ys = shape.points.filter((_, at) => at % 2 === 1).map((y) => y * height);
  const common = {
    stroke,
    strokeWidth: 3,
    fill: "none",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "data-shape": shape.tool,
    "data-color": shape.color,
  };
  if (shape.tool === "pen") {
    const d = xs.map((x, at) => `${at === 0 ? "M" : "L"}${x.toFixed(1)} ${ys[at].toFixed(1)}`);
    return <path d={d.join(" ")} {...common} />;
  }
  const [x1, y1, x2, y2] = [xs[0], ys[0], xs[xs.length - 1], ys[ys.length - 1]];
  if (shape.tool === "box") {
    return (
      <rect
        x={Math.min(x1, x2)}
        y={Math.min(y1, y2)}
        width={Math.abs(x2 - x1)}
        height={Math.abs(y2 - y1)}
        rx={2}
        {...common}
      />
    );
  }
  const [ax, ay, bx, by] = arrowHead(x1, y1, x2, y2, 14);
  return (
    <path d={`M${x1} ${y1} L${x2} ${y2} M${ax} ${ay} L${x2} ${y2} L${bx} ${by}`} {...common} />
  );
}

/**
 * Marks over the picture, sized to it. With `onAdd`, it also takes new marks from the
 * pointer; without, it only shows them and lets clicks through to the clip.
 */
export function DrawingLayer({
  shapes,
  tool = "pen",
  color = "red",
  onAdd,
}: {
  shapes: readonly Shape[];
  tool?: DrawTool;
  color?: DrawColor;
  onAdd?: (shape: Shape) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 100, height: 100 });
  const [current, setCurrent] = useState<Shape | null>(null);

  useEffect(() => {
    const element = svg.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  function at(event: PointerEvent<SVGSVGElement>): [number, number] {
    const box = event.currentTarget.getBoundingClientRect();
    const share = (value: number, start: number, length: number) =>
      length > 0 ? Math.min(1, Math.max(0, (value - start) / length)) : 0;
    return [share(event.clientX, box.left, box.width), share(event.clientY, box.top, box.height)];
  }

  const drawing = Boolean(onAdd);
  return (
    <svg
      ref={svg}
      role={drawing ? "img" : undefined}
      aria-label={drawing ? "Drawing area: drag on the picture to draw" : undefined}
      aria-hidden={drawing ? undefined : true}
      data-drawing={drawing ? "editing" : "showing"}
      viewBox={`0 0 ${size.width} ${size.height}`}
      className={cn(
        "absolute inset-0 size-full touch-none",
        drawing ? "cursor-crosshair" : "pointer-events-none",
      )}
      onPointerDown={(event) => {
        if (!onAdd || event.button !== 0) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        const [x, y] = at(event);
        setCurrent({ tool, color, points: [x, y, x, y] });
      }}
      onPointerMove={(event) => {
        if (!current) return;
        const [x, y] = at(event);
        if (current.tool === "pen") {
          const points = current.points;
          const [lastX, lastY] = points.slice(-2);
          if (Math.hypot(x - lastX, y - lastY) < STEP) return;
          // The second point starts as a copy of the first; replace it instead of adding.
          const base = points.length === 4 && points[0] === points[2] && points[1] === points[3];
          setCurrent({
            ...current,
            points: base ? [points[0], points[1], x, y] : [...points, x, y],
          });
        } else {
          setCurrent({ ...current, points: [current.points[0], current.points[1], x, y] });
        }
      }}
      onPointerUp={() => {
        if (current && onAdd) onAdd(current);
        setCurrent(null);
      }}
      onPointerCancel={() => setCurrent(null)}
    >
      {[...shapes, ...(current ? [current] : [])].map((shape, index) => (
        <ShapeMark key={index} shape={shape} width={size.width} height={size.height} />
      ))}
    </svg>
  );
}

/** The drawing tools, in place of the timeline while someone draws. */
export function DrawingTools({
  tool,
  color,
  count,
  onTool,
  onColor,
  onUndo,
  onClear,
  onDone,
}: {
  tool: DrawTool;
  color: DrawColor;
  count: number;
  onTool: (tool: DrawTool) => void;
  onColor: (color: DrawColor) => void;
  onUndo: () => void;
  onClear: () => void;
  onDone: () => void;
}) {
  const button =
    "flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs text-zinc-300 outline-none transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60 disabled:pointer-events-none disabled:opacity-40";
  return (
    <div
      role="toolbar"
      aria-label="Drawing tools"
      className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-3 pb-4"
    >
      <div className="flex rounded-lg bg-white/10 p-0.5">
        {TOOLS.map(({ tool: name, label, icon: Icon }) => (
          <button
            key={name}
            type="button"
            aria-pressed={tool === name}
            onClick={() => onTool(name)}
            className={cn(button, "h-7", tool === name && "bg-white/20 font-medium text-white")}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        ))}
      </div>
      <div role="group" aria-label="Colour" className="flex items-center gap-1.5">
        {(Object.keys(DRAW_COLORS) as DrawColor[]).map((name) => (
          <button
            key={name}
            type="button"
            aria-label={COLOR_NAMES[name]}
            aria-pressed={color === name}
            onClick={() => onColor(name)}
            className={cn(
              "size-5 rounded-full outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-white/60",
              color === name && "ring-2 ring-white ring-offset-2 ring-offset-zinc-950",
            )}
            style={{ backgroundColor: DRAW_COLORS[name] }}
          />
        ))}
      </div>
      <div className="ml-auto flex items-center gap-1">
        <button type="button" className={button} disabled={count === 0} onClick={onUndo}>
          <Undo2 className="size-3.5" />
          Undo
        </button>
        <button type="button" className={button} disabled={count === 0} onClick={onClear}>
          <Eraser className="size-3.5" />
          Clear
        </button>
        <button
          type="button"
          onClick={onDone}
          className="flex h-8 items-center gap-1.5 rounded-md bg-white px-3 text-xs font-medium text-zinc-950 outline-none transition-transform hover:scale-[1.03] focus-visible:ring-3 focus-visible:ring-white/50 active:scale-95"
        >
          <Check className="size-3.5" />
          Done
        </button>
      </div>
    </div>
  );
}

/** What the stage needs to show or take a drawing. */
export type StageDrawing = {
  shapes: readonly Shape[];
  editing: null | {
    tool: DrawTool;
    color: DrawColor;
    onTool: (tool: DrawTool) => void;
    onColor: (color: DrawColor) => void;
    onAdd: (shape: Shape) => void;
    onUndo: () => void;
    onClear: () => void;
    onDone: () => void;
  };
};

/** What the comment box needs to offer drawing with the next comment. */
export type ComposerDrawing = {
  drawing: boolean;
  count: number;
  onToggle: () => void;
  onRemove: () => void;
};

/**
 * The drawing that goes with the next comment, and the saved drawing of the thread in
 * view. A saved drawing shows while the clip is paused at its thread's moment.
 */
export function useFrameDrawing<T extends ReviewComment & { drawing?: Shape[] | null }>({
  video,
  threads,
  active,
  time,
  playing,
}: {
  video: RefObject<HTMLVideoElement | null>;
  threads: Thread<T>[];
  active: string | null;
  time: number;
  playing: boolean;
}) {
  const [drawing, setDrawing] = useState(false);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [tool, setTool] = useState<DrawTool>("pen");
  const [color, setColor] = useState<DrawColor>("red");

  const root = threads.find((thread) => thread.root.id === active)?.root;
  const saved = root?.drawing && !playing && Math.abs(time - root.time) < 0.3 ? root.drawing : null;

  const stage: StageDrawing | null = drawing
    ? {
        shapes,
        editing: {
          tool,
          color,
          onTool: setTool,
          onColor: setColor,
          onAdd: (shape) => setShapes((current) => [...current, shape].slice(0, SHAPE_LIMIT)),
          onUndo: () => setShapes((current) => current.slice(0, -1)),
          onClear: () => setShapes([]),
          onDone: () => setDrawing(false),
        },
      }
    : shapes.length > 0
      ? { shapes, editing: null }
      : saved
        ? { shapes: saved, editing: null }
        : null;

  const composer: ComposerDrawing = {
    drawing,
    count: shapes.length,
    onToggle: () => {
      if (!drawing) video.current?.pause();
      setDrawing(!drawing);
    },
    onRemove: () => {
      setShapes([]);
      setDrawing(false);
    },
  };

  return {
    stage,
    composer,
    /** The drawing to send with a new thread, if any. */
    pending: shapes.length > 0 ? shapes : undefined,
    /** Called once the comment carrying the drawing is saved. */
    sent: () => {
      setShapes([]);
      setDrawing(false);
    },
  };
}
