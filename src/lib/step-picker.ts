import { actionTypesByGroup } from "@takewon/automation-core";

/**
 * The groups the canvas's step list offers. Steps the agent saved for the team stay out
 * of it: they show only inside the automations the agent builds with them.
 */
export function pickerGroups() {
  return actionTypesByGroup().filter(({ group }) => group !== "team");
}
