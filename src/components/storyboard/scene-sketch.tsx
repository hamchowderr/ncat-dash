import { type Scene, sceneLabel } from "@convex/lib/storyboard";

import { cn } from "@/lib/utils";

/**
 * A small drawing of how a scene is laid out: where you are and where the graphic goes.
 * It shows the layout, not the take itself.
 */
export function SceneSketch({ scene, className }: { scene: Scene; className?: string }) {
  const person = "fill-zinc-500";
  const block = "fill-zinc-700";
  const accent = "fill-amber-300";
  return (
    <svg
      viewBox="0 0 128 72"
      role="img"
      aria-label={`${sceneLabel(scene)} layout`}
      data-scene={scene}
      className={cn("aspect-video w-28 shrink-0 rounded-md bg-zinc-900", className)}
    >
      {scene === "full" && (
        <>
          <circle cx="64" cy="28" r="14" className={person} />
          <path d="M38 72 Q38 46 64 46 Q90 46 90 72 Z" className={person} />
          <rect x="10" y="10" width="40" height="6" rx="3" className={accent} />
        </>
      )}
      {scene === "panel" && (
        <>
          <rect x="6" y="6" width="44" height="60" rx="5" className={block} />
          <circle cx="28" cy="30" r="9" className={person} />
          <path d="M14 66 Q14 44 28 44 Q42 44 42 66 Z" className={person} />
          <rect x="58" y="14" width="60" height="7" rx="3" className={accent} />
          <rect x="58" y="28" width="60" height="8" rx="3" className={block} />
          <rect x="58" y="41" width="60" height="8" rx="3" className={block} />
          <rect x="58" y="54" width="44" height="8" rx="3" className={block} />
        </>
      )}
      {scene === "centre" && (
        <>
          <rect x="48" y="8" width="32" height="56" rx="5" className={block} />
          <circle cx="64" cy="28" r="8" className={person} />
          <path d="M52 64 Q52 42 64 42 Q76 42 76 64 Z" className={person} />
          <rect x="8" y="18" width="34" height="7" rx="3" className={accent} />
          <rect x="8" y="32" width="34" height="7" rx="3" className={block} />
          <rect x="86" y="18" width="34" height="7" rx="3" className={accent} />
          <rect x="86" y="32" width="34" height="7" rx="3" className={block} />
        </>
      )}
      {scene === "graphic" && (
        <>
          <rect x="12" y="12" width="50" height="7" rx="3" className={accent} />
          <rect x="12" y="40" width="104" height="3" rx="2" className="fill-zinc-600" />
          <circle cx="25" cy="41" r="7" className="fill-zinc-400" />
          <circle cx="64" cy="41" r="7" className="fill-zinc-400" />
          <circle cx="103" cy="41" r="7" className={accent} />
        </>
      )}
      {scene === "circle" && (
        <>
          <rect x="10" y="12" width="40" height="30" rx="4" className={block} />
          <rect x="56" y="12" width="40" height="30" rx="4" className={block} />
          <circle cx="108" cy="54" r="13" className="fill-amber-300" />
          <circle cx="108" cy="54" r="11" className={person} />
        </>
      )}
    </svg>
  );
}
