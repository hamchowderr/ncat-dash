import type { ApprovalViews } from "@/components/chat/approval-view";

import { toolWords } from "./tool-words";

/** What each card that asks first says: the change in plain words, never raw settings. */
export const APPROVAL_VIEWS: ApprovalViews = Object.fromEntries(
  [
    "change_automation",
    "create_automation",
    "switch_automation",
    "try_automation",
    "try_team_step",
    "save_team_step",
    "make_folder",
    "move_files",
    "rename_file",
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
