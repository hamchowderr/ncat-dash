// Emails for product news: the announcements the operator writes on the Send An Email
// page, and the note that asks someone who signed up on the website to confirm.

import { compose, type Branding, type Composed } from "./messages";

/** Who an announcement goes to, which decides why the footer says they got it. */
export type AnnouncementAudience = "news" | "accounts";

export type Announcement = {
  subject: string;
  /** The big line at the top. The subject when left out. */
  heading?: string;
  /** Plain text. A blank line starts a new paragraph. */
  body: string;
  button?: { label: string; url: string };
};

/** Splits plain text into paragraphs at blank lines, joining wrapped lines. */
export function paragraphsOf(body: string): string[] {
  return body
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
}

/** One announcement, written once and sent to everyone in the audience. */
export function announcementEmail(
  announcement: Announcement,
  audience: AnnouncementAudience,
  branding: Branding,
  options: { postalAddress?: string } = {},
): Composed {
  const app = branding.appName;
  return compose(
    announcement.subject,
    {
      heading: announcement.heading?.trim() || announcement.subject,
      paragraphs: paragraphsOf(announcement.body),
      ...(announcement.button ? { button: announcement.button } : {}),
      reason:
        audience === "news"
          ? `You get this because you asked for ${app} product news.`
          : `You get this because you have a ${app} account. It is about your account or the service, not marketing.`,
      ...(options.postalAddress ? { footnote: options.postalAddress } : {}),
    },
    branding,
  );
}

/** Sent to someone who signed up for product news on the website, before anything else. */
export function confirmNewsEmail(args: { url: string }, branding: Branding): Composed {
  const app = branding.appName;
  return compose(
    `Confirm you want ${app} product news`,
    {
      heading: "One click to confirm",
      paragraphs: [
        `Someone, hopefully you, asked for ${app} product news at this address.`,
        "Confirm and we'll send the occasional email about new features and tips. Nothing else, and you can stop any time.",
      ],
      button: { label: "Yes, send me product news", url: args.url },
      footnote: "Didn't ask for this? Ignore this email and you won't hear from us again.",
    },
    branding,
  );
}
