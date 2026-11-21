import { vi } from "vitest";

/**
 * Pretends the window is a given width for the screens' width queries (jsdom has no
 * matchMedia). `max-width` queries match when the window is at most that wide.
 */
export function windowWidth(px: number) {
  vi.stubGlobal("matchMedia", (query: string) => {
    const rem = /max-width:\s*([\d.]+)rem/.exec(query);
    const limit = rem ? Number(rem[1]) * 16 : Infinity;
    return {
      matches: px <= limit,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
  });
}
