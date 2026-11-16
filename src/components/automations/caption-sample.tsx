"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

const WORDS = ["so", "the", "trick", "is", "cutting", "right", "at", "the", "pause"];

/** A short sample of how burned-in captions look, with the current word highlighted. */
export function CaptionSample({ active }: { active: boolean }) {
  const [word, setWord] = useState(0);

  useEffect(() => {
    if (!active || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => setWord((current) => (current + 1) % WORDS.length), 360);
    return () => clearInterval(timer);
  }, [active]);

  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex flex-wrap justify-center gap-x-[0.35em] rounded-lg bg-neutral-900 px-3 py-4 text-lg font-extrabold tracking-tight uppercase transition-[opacity,filter] duration-300",
        !active && "opacity-30 grayscale",
      )}
    >
      {WORDS.map((text, index) => (
        <span
          key={index}
          className={cn(
            "transition-[color,transform] duration-100",
            active && index === word ? "scale-108 text-amber-400" : "text-white",
          )}
        >
          {text}
        </span>
      ))}
    </div>
  );
}
