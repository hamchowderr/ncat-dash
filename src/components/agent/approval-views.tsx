import type { ApprovalViews } from "@/components/chat/approval-view";

import { categoryTitle } from "@convex/lib/supportCategories";

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
 * A help request goes out in the person's name, so its card shows it the way support
 * will read it: the subject, what it's about and the whole message.
 */
DASHBOARD_VIEWS.ask_for_help = ({ args }) => {
  const given = (args ?? {}) as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const about = categoryTitle(text(given.category));
  return {
    title: "Send this to support?",
    body: (
      <div className="grid gap-2 text-sm" data-help-request>
        <div>
          <p className="font-medium">{text(given.subject)}</p>
          {about && <p className="text-muted-foreground text-xs">{about}</p>}
        </div>
        <p className="bg-surface max-h-48 overflow-y-auto rounded-xl px-3 py-2 leading-relaxed whitespace-pre-wrap">
          {text(given.message)}
        </p>
        <p className="text-muted-foreground text-xs">
          Your team and latest runs go with it. The answer comes to Get Help and by email.
        </p>
      </div>
    ),
  };
};

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
