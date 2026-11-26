/**
 * Marks a file still on the storage the team used before it switched servers: one on
 * Takewon's storage still plays and runs from there; one on another earlier storage can
 * no longer be reached.
 */
export const STORED_ELSEWHERE = {
  hosted: {
    label: "On Takewon's storage",
    title:
      "Uploaded before your team switched to its own server. It stays on Takewon's storage and still plays and runs from there.",
  },
  earlier: {
    label: "On earlier storage",
    title:
      "On the storage your team used before it switched servers, which can no longer be reached. Upload it again to use it.",
  },
} as const;

export function StoredElsewhere({ where }: { where: "hosted" | "earlier" | null | undefined }) {
  if (!where) return null;
  const look = STORED_ELSEWHERE[where];
  return (
    <span
      title={look.title}
      className={
        where === "hosted"
          ? "bg-muted text-muted-foreground shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium"
          : "shrink-0 rounded-md bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-900"
      }
    >
      {look.label}
    </span>
  );
}
