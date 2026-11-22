import { fireEvent, render, screen as page } from "@testing-library/react";
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

/**
 * Opens a tab on a settings page, the way a click does. Radix tabs switch on the press of
 * the mouse button, which a bare `fireEvent.click` never sends.
 */
export async function openTab(name: string | RegExp) {
  const tab = await page.findByRole("tab", { name });
  fireEvent.mouseDown(tab, { button: 0, ctrlKey: false });
  return tab;
}
