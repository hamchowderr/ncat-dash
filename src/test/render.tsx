import { render, screen as page } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { TeamContext } from "@/lib/team-context";

export const TEAM = { id: "team_1", name: "Salt House" };

function InApp({ children }: { children: ReactNode }) {
  return (
    <TeamContext.Provider value={TEAM}>
      <TooltipProvider>{children}</TooltipProvider>
    </TeamContext.Provider>
  );
}

/**
 * Renders a screen the way the app shell would: inside a team, with tooltips available.
 * `rerender` keeps it there.
 */
export function renderInApp(screen: ReactElement) {
  return render(screen, { wrapper: InApp });
}

/** Picks a choice from one of the app's pick lists: opens it, then clicks the option. */
export async function pick(
  user: { click: (element: Element) => Promise<void> },
  list: HTMLElement,
  option: string | RegExp,
) {
  await user.click(list);
  await user.click(await page.findByRole("option", { name: option }));
}
