"use client";

import { createContext, useContext } from "react";

export type ActiveTeam = { id: string; name: string };

export const TeamContext = createContext<ActiveTeam | null>(null);

/** The team the signed-in user is working in. Only usable inside the app shell. */
export function useActiveTeam(): ActiveTeam {
  const team = useContext(TeamContext);
  if (!team) throw new Error("useActiveTeam must be used inside the app shell");
  return team;
}
