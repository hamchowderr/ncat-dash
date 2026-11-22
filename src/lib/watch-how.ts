/**
 * The explainer videos and the pages they explain. "Watch how" in the bar along the top
 * plays the ones for the page someone is on. The videos live on the Takewon website, so
 * every copy of the dashboard, self-hosted ones too, plays the latest without an update.
 */

export type Explainer = { slug: string; title: string; seconds: number };

const VIDEOS = [
  ["01-getting-set-up", "Getting Set Up", 96],
  ["02-start-from-a-template", "Start From A Template", 66],
  ["03-build-your-own-automation", "Build Your Own Automation", 84],
  ["04-other-ways-to-start", "Other Ways To Start", 74],
  ["05-how-steps-connect-themselves", "How Steps Connect Themselves", 84],
  ["06-test-a-step", "Test A Step", 67],
  ["07-set-your-brand-once", "Set Your Brand Once", 71],
  ["08-drafts-publishing-and-undo", "Drafts, Publishing And Undo", 73],
  ["09-logic-steps", "Logic Steps", 78],
  ["10-your-team", "Your Team", 67],
  ["11-approvals", "Approvals", 80],
  ["12-when-something-fails", "When Something Fails", 76],
  ["13-a-backup-plan-when-a-step-fails", "A Backup Plan When A Step Fails", 62],
  ["14-your-files", "Your Files", 76],
  ["15-open-in-your-editor", "Open In Your Editor", 66],
  ["16-share-an-automation", "Share An Automation", 46],
  ["17-the-agent", "The Agent", 84],
  ["18-the-review-room", "The Review Room", 86],
  ["19-your-library", "Your Library", 74],
  ["20-your-calendar", "Your Calendar", 76],
  ["21-clients-and-projects", "Clients And Projects", 78],
  ["22-chains", "Chains", 58],
  ["23-b-roll-and-motion", "B-Roll And Motion", 96],
  ["24-your-inbox", "Your Inbox", 74],
  ["25-home", "Home", 52],
  ["26-jobs", "Jobs", 52],
  ["27-meeting-imports", "Meeting Imports", 71],
  ["28-chat-alerts", "Chat Alerts", 66],
] as const;

export type ExplainerSlug = (typeof VIDEOS)[number][0];

export const EXPLAINERS: readonly Explainer[] = VIDEOS.map(([slug, title, seconds]) => ({
  slug,
  title,
  seconds,
}));

const byNumber = (n: number) => EXPLAINERS[n - 1];

/** Pages, most specific first; the first that matches decides. Each lists its videos, best first. */
const PAGES: Array<[match: RegExp, videos: number[]]> = [
  [/^\/$/, [25, 1, 17]],
  [/^\/get-started/, [1]],
  [/^\/inbox/, [24, 11, 12, 28]],
  [/^\/automations\/new/, [4, 2]],
  [/^\/automations\/[^/]+\/runs\//, [12, 13]],
  [/^\/automations\/[^/]+/, [3, 5, 8, 9, 13, 22, 23, 16]],
  [/^\/automations/, [2, 4, 3, 16, 17]],
  [/^\/runs/, [12, 13]],
  [/^\/review/, [18, 11]],
  [/^\/calendar/, [20]],
  [/^\/(clients|projects)/, [21]],
  [/^\/library/, [19]],
  [/^\/files/, [14, 15]],
  [/^\/uploads/, [27]],
  [/^\/steps/, [6]],
  [/^\/jobs/, [26, 6]],
  [/^\/settings\/brand/, [7]],
  [/^\/settings\/(captions|motion|broll)/, [7, 23]],
  [/^\/settings\/team(\/|$)/, [10]],
  [/^\/settings\/notifications/, [28]],
  [/^\/settings\/(integrations\/)?(slack|discord|telegram|teams)(\/|$)/, [28]],
  [/^\/settings\/(integrations\/)?(zoom|google-meet|microsoft|dropbox)(\/|$)/, [27]],
  [/^\/settings\/runs/, [13]],
];

/** The videos for a page, best first. None for a page no video explains. */
export function videosFor(pathname: string): Explainer[] {
  const page = PAGES.find(([match]) => match.test(pathname));
  return page ? page[1].map(byNumber) : [];
}

export const DEFAULT_WATCH_URL = "https://takewon.com/watch";

/** Where a video plays from. NEXT_PUBLIC_WATCH_URL points copies at another place. */
export function videoUrl(slug: string, base = process.env.NEXT_PUBLIC_WATCH_URL) {
  return `${(base || DEFAULT_WATCH_URL).replace(/\/+$/, "")}/${slug}.mp4`;
}

export function lengthOf(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
