// What a help request can be about. The customer picks one on Get Help, the assistant
// picks one when it opens a request for them, and support filters the inbox by them.
// Plain words, the way the person would say it, as Help Scout and Plain advise for
// customer-facing fields. Shared by Convex and the screens (@convex/lib/supportCategories).

export const SUPPORT_CATEGORIES = [
  {
    id: "automations",
    title: "Automations and runs",
    hint: "Something didn't start, stopped or failed.",
  },
  {
    id: "results",
    title: "Clips, captions and edits",
    hint: "Something came out looking or sounding wrong.",
  },
  { id: "files", title: "Uploads and files", hint: "A file won't upload, play or show up." },
  {
    id: "connections",
    title: "Connected apps",
    hint: "Slack, Discord, Telegram, n8n or an AI app.",
  },
  { id: "account", title: "Account and team", hint: "Signing in, members and invites." },
  { id: "billing", title: "Plan and billing", hint: "Your trial, plan or a payment." },
  { id: "idea", title: "An idea", hint: "Something you'd like Takewon to do." },
  { id: "other", title: "Something else", hint: "Anything that fits nowhere above." },
] as const;

export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number]["id"];

export const SUPPORT_CATEGORY_IDS = SUPPORT_CATEGORIES.map((c) => c.id) as [
  SupportCategory,
  ...SupportCategory[],
];

export function isSupportCategory(value: unknown): value is SupportCategory {
  return SUPPORT_CATEGORY_IDS.includes(value as SupportCategory);
}

export function categoryTitle(id: string | null | undefined): string | null {
  return SUPPORT_CATEGORIES.find((c) => c.id === id)?.title ?? null;
}

/**
 * A first guess from the page the person came from, so the form usually starts on the
 * right category. They can always pick another.
 */
export function categoryForPage(page: string | null | undefined): SupportCategory | null {
  if (!page) return null;
  const path = page.split(/[?#]/)[0];
  const starts = (...prefixes: string[]) =>
    prefixes.some((p) => path === p || path.startsWith(`${p}/`));
  if (starts("/automations", "/runs", "/jobs", "/steps", "/toolkit", "/settings/runs"))
    return "automations";
  if (starts("/review", "/projects", "/outputs", "/settings/captions", "/settings/motion"))
    return "results";
  if (starts("/files", "/library", "/uploads")) return "files";
  if (starts("/settings/integrations", "/settings/agent")) return "connections";
  if (starts("/settings/team", "/settings/account")) return "account";
  return null;
}

/** Where a request came from, when it wasn't the person's own form. */
export const SUPPORT_VIA = {
  assistant: "Opened by the assistant in chat",
  mcp: "Opened by an AI app",
} as const;

export type SupportVia = keyof typeof SUPPORT_VIA;
