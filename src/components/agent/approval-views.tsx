import type { ApprovalViews } from "@/components/chat/approval-view";

import { plainTitle, toolWords } from "./tool-words";

/** What each card that asks first says: the change in plain words, never raw settings. */
const DASHBOARD_VIEWS: ApprovalViews = Object.fromEntries(
  [
    "change_automation",
    "create_automation",
    "switch_automation",
    "set_up_workflow",
    "switch_workflow",
    "try_automation",
    "try_team_step",
    "save_team_step",
    "make_folder",
    "move_files",
    "rename_file",
    "write_storyboard",
    "storyboard_from_upload",
    "match_storyboard_takes",
    "make_storyboard_video",
  ].map((name) => [
    name,
    ({ args }) => {
      const words = toolWords(name, args);
      if (!words) return null;
      return {
        title: words.question,
        body: (
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {words.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ),
      };
    },
  ]),
);

/**
 * Every other tool that asks first (the browser, schedules, files in the agent's
 * workspace) gets a plain title too, in place of its tool id; its details show below.
 */
export const APPROVAL_VIEWS: ApprovalViews = new Proxy(DASHBOARD_VIEWS, {
  get(views, name) {
    if (typeof name !== "string") return undefined;
    if (Object.hasOwn(views, name)) return views[name];
    return () => ({ title: `Allow this? ${plainTitle(name)}` });
  },
});
