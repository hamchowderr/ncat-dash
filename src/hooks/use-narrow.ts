import { useSyncExternalStore } from "react";

/** Phone width: narrower than Tailwind's `sm` (40rem). */
export const PHONE = "(max-width: 39.999rem)";
/** Narrower than Tailwind's `lg` (64rem), where the review room stacks into one column. */
export const NARROW = "(max-width: 63.999rem)";

function media(query: string): MediaQueryList | null {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(query)
    : null;
}

/**
 * Whether the window matches a width query. Screens that move a control somewhere else on a
 * small screen ask this instead of drawing it twice and hiding one copy. The server, and a
 * browser that cannot tell, get the wide layout.
 */
export function useMedia(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const list = media(query);
      list?.addEventListener("change", onChange);
      return () => list?.removeEventListener("change", onChange);
    },
    () => media(query)?.matches ?? false,
    () => false,
  );
}

export const useNarrow = () => useMedia(NARROW);
export const usePhone = () => useMedia(PHONE);
