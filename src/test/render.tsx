import { render } from "@testing-library/react";
import type { ReactElement } from "react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { TeamContext } from "@/lib/team-context";

export const TEAM = { id: "team_1", name: "Salt House" };

/** Renders a screen the way the app shell would: inside a team, with tooltips available. */
export function renderInApp(screen: ReactElement) {
  return render(
    <TeamContext.Provider value={TEAM}>
      <TooltipProvider>{screen}</TooltipProvider>
    </TeamContext.Provider>,
  );
}
