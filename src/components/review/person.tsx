import { initialsOf } from "@ncat-dash/review-core";

import { cn } from "@/lib/utils";

export type Person = { id: string; name: string; image: string | null };

// Each person keeps one colour everywhere in the room: their face in the header, their
// comments, and their marks on the timeline.
const COLOURS = [
  "bg-rose-600",
  "bg-teal-700",
  "bg-indigo-600",
  "bg-amber-700",
  "bg-sky-700",
  "bg-fuchsia-700",
  "bg-emerald-700",
  "bg-orange-700",
];

function colourOf(id: string): string {
  let sum = 0;
  for (const letter of id) sum = (sum * 31 + letter.charCodeAt(0)) % 9973;
  return COLOURS[sum % COLOURS.length];
}

/** A person's picture, or their initials on their colour. */
export function Face({
  id,
  name,
  image,
  className,
}: {
  id: string;
  name: string;
  image?: string | null;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full text-[0.65rem] font-semibold text-white select-none",
        colourOf(id),
        className,
      )}
    >
      {image ? (
        // Profile pictures can sit on any address the person chose.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className="size-full object-cover" />
      ) : (
        initialsOf(name)
      )}
    </span>
  );
}
