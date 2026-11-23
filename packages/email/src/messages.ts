// The emails this app sends, written once as plain data: a subject, a text version and
// an HTML version. Nothing here sends anything.

export type Composed = {
  subject: string;
  text: string;
  html: string;
  /** Extra headers to send with it, such as one-click unsubscribe. */
  headers?: Record<string, string>;
};

/** Where `withUnsubscribe` puts its link in an email's footer. */
const UNSUBSCRIBE_SLOT = "<!--unsubscribe-->";

export type Branding = {
  /** Shown as the sender's name and in the footer. */
  appName: string;
};

export const DEFAULT_APP_NAME = "Takewon";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Keeps a name from carrying line breaks into a subject line. */
function oneLine(value: string, max = 120): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

type Layout = {
  heading: string;
  paragraphs: string[];
  /** Words someone wrote, such as a comment, set apart from ours. */
  quote?: string;
  /** Linked lines, such as the items of a daily summary. */
  items?: { title: string; detail?: string; url: string }[];
  button?: { label: string; url: string };
  footnote?: string;
  /** Why this person gets the email, shown above the footer with a link to change it. */
  reason?: string;
  settingsUrl?: string;
};

/** Takewon's violet, from takewon.com. Used for the mark, the button and links. */
const ACCENT = "#5b3df5";
const INK = "#0b0b12";
const SOFT = "#4f5260";
const MUTE = "#6b6e7c";
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** The motto, said exactly this way wherever it is used. */
export const MOTTO = "Your content, social media ready.";

/** Who makes Takewon, named where a company normally is: an email's footer. */
export const COMPANY = "Otaku Solutions";

/**
 * The mark beside the name: a violet square with a play shape, drawn in HTML rather than
 * an image, so it shows even where a mail app holds images back.
 */
function mark(): string {
  return `<td style="width:28px;height:28px;background:${ACCENT};border-radius:8px;text-align:center;vertical-align:middle;color:#ffffff;font-size:12px;line-height:28px;font-family:${FONT};">&#9654;</td>`;
}

function compose(subject: string, layout: Layout, branding: Branding): Composed {
  const { heading, paragraphs, quote, items, button, footnote, reason, settingsUrl } = layout;
  const ours = branding.appName === DEFAULT_APP_NAME;
  const text = [
    heading,
    "",
    ...paragraphs.flatMap((paragraph) => [paragraph, ""]),
    ...(quote ? [`"${quote}"`, ""] : []),
    ...(items ?? []).flatMap((item) => [
      `- ${item.title}${item.detail ? `: ${item.detail}` : ""} (${item.url})`,
    ]),
    ...(items?.length ? [""] : []),
    ...(button ? [`${button.label}: ${button.url}`, ""] : []),
    ...(footnote ? [footnote, ""] : []),
    "--",
    ...(reason ? [reason] : []),
    ...(settingsUrl ? [`Notification settings: ${settingsUrl}`] : []),
    ours ? `${branding.appName}. ${MOTTO} Made by ${COMPANY}.` : `Sent by ${branding.appName}.`,
  ].join("\n");

  const p = (content: string, style = "") =>
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${SOFT};${style}">${content}</p>`;
  const link = (url: string, label: string) =>
    `<a href="${escapeHtml(url)}" style="color:${ACCENT};text-decoration:underline;">${escapeHtml(label)}</a>`;
  // The first line shows beside the subject in the inbox; without it, mail apps show
  // whatever text comes first, which would be the app's name.
  const preview = oneLine(paragraphs[0] ?? heading, 140);
  const html = [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head>',
    `<body style="margin:0;padding:0;background:#f4f4f7;font-family:${FONT};">`,
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preview)}&#8203;</div>`,
    '<div style="max-width:560px;margin:0 auto;padding:32px 16px;">',
    // Header: the mark and the name.
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px 4px;"><tr>${ours ? mark() : ""}<td style="padding-left:${ours ? 10 : 0}px;font-size:17px;font-weight:700;letter-spacing:-0.01em;color:${INK};font-family:${FONT};">${escapeHtml(branding.appName)}</td></tr></table>`,
    // The card.
    '<div style="background:#ffffff;border-radius:16px;padding:32px;">',
    `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;font-weight:700;letter-spacing:-0.01em;color:${INK};">${escapeHtml(heading)}</h1>`,
    ...paragraphs.map((paragraph) => p(escapeHtml(paragraph))),
    ...(quote
      ? [
          `<div style="margin:0 0 16px;padding:14px 16px;background:#f4f4f7;border-radius:10px;font-size:15px;line-height:1.6;color:${INK};">${escapeHtml(quote)}</div>`,
        ]
      : []),
    ...(items?.length
      ? [
          '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 8px;">',
          ...items.map(
            (item) =>
              `<tr><td style="padding:12px 0;border-top:1px solid #ebebf0;"><a href="${escapeHtml(item.url)}" style="font-size:15px;font-weight:600;color:${INK};text-decoration:none;">${escapeHtml(item.title)}</a>${item.detail ? `<div style="font-size:14px;line-height:1.5;color:${MUTE};margin-top:2px;">${escapeHtml(item.detail)}</div>` : ""}</td></tr>`,
          ),
          "</table>",
        ]
      : []),
    ...(button
      ? [
          `<p style="margin:24px 0;"><a href="${escapeHtml(button.url)}" style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 20px;border-radius:10px;">${escapeHtml(button.label)}</a></p>`,
          p(
            `If the button does not work, open this link: <a href="${escapeHtml(button.url)}" style="color:${ACCENT};word-break:break-all;">${escapeHtml(button.url)}</a>`,
            `font-size:13px;color:${MUTE};`,
          ),
        ]
      : []),
    ...(footnote ? [p(escapeHtml(footnote), `font-size:13px;color:${MUTE};margin:0;`)] : []),
    "</div>",
    // Footer: why this came, where to change it, and who sent it.
    `<div style="padding:20px 4px 0;font-size:12px;line-height:1.6;color:${MUTE};">`,
    ...(reason || settingsUrl
      ? [
          `<p style="margin:0 0 8px;">${reason ? `${escapeHtml(reason)} ` : ""}${settingsUrl ? link(settingsUrl, "Change your notification settings") : ""}${UNSUBSCRIBE_SLOT}</p>`,
        ]
      : []),
    ours
      ? `<p style="margin:0;">${escapeHtml(branding.appName)}. ${escapeHtml(MOTTO)}<br>Made by ${escapeHtml(COMPANY)}.</p>`
      : `<p style="margin:0;">Sent by ${escapeHtml(branding.appName)}.</p>`,
    "</div>",
    "</div>",
    "</body></html>",
  ].join("");

  return { subject: oneLine(subject, 200), text, html };
}

export function verificationEmail(args: { name?: string; url: string }, branding: Branding) {
  return compose(
    "Confirm your email address",
    {
      heading: "Confirm your email address",
      paragraphs: [
        `${args.name ? `Hi ${oneLine(args.name, 60)}, c` : "C"}onfirm this is your address so you can sign in and we can reach you about your automations.`,
      ],
      button: { label: "Confirm email address", url: args.url },
      footnote: "If you did not ask for this, you can ignore this email.",
    },
    branding,
  );
}

/** Sent to the old address when someone asks to move their account to a new one. */
export function emailChangeEmail(
  args: { name?: string; newEmail: string; url: string },
  branding: Branding,
) {
  const next = oneLine(args.newEmail, 120);
  return compose(
    "Approve your new email address",
    {
      heading: "Approve your new email address",
      paragraphs: [
        `${args.name ? `Hi ${oneLine(args.name, 60)}, s` : "S"}omeone asked to move this account to ${next}.`,
        `Approve it here, then confirm from the email we send to ${next}. Until both are done, you keep signing in with this address.`,
      ],
      button: { label: "Approve the change", url: args.url },
      footnote:
        "If that was not you, ignore this email and change your password: nothing moves without this link.",
    },
    branding,
  );
}

/** Sent after a password is changed or reset, so a change nobody asked for is noticed. */
export function passwordChangedEmail(args: { name?: string; url: string }, branding: Branding) {
  return compose(
    "Your password was changed",
    {
      heading: "Your password was changed",
      paragraphs: [
        `${args.name ? `Hi ${oneLine(args.name, 60)}, t` : "T"}he password for this account was just changed.`,
      ],
      button: { label: "Reset it again", url: args.url },
      footnote: "If that was you, there is nothing to do.",
    },
    branding,
  );
}

export function passwordResetEmail(args: { name?: string; url: string }, branding: Branding) {
  return compose(
    "Reset your password",
    {
      heading: "Reset your password",
      paragraphs: [
        `${args.name ? `Hi ${oneLine(args.name, 60)}, s` : "S"}omeone asked to reset the password for this account. The link works for one hour.`,
      ],
      button: { label: "Choose a new password", url: args.url },
      footnote: "If that was not you, ignore this email and your password stays as it is.",
    },
    branding,
  );
}

export function invitationEmail(
  args: { teamName: string; inviterName?: string; role: string; url: string },
  branding: Branding,
) {
  const team = oneLine(args.teamName, 60);
  const inviter = args.inviterName ? oneLine(args.inviterName, 60) : "Someone";
  return compose(
    `${inviter} invited you to ${team}`,
    {
      heading: `Join ${team}`,
      paragraphs: [
        `${inviter} invited you to join the team ${team} as ${args.role === "admin" ? "an admin" : `a ${oneLine(args.role, 20)}`}.`,
        "Sign in or create an account with this email address to accept.",
      ],
      button: { label: "Accept invitation", url: args.url },
      footnote: "If you were not expecting this, you can ignore it.",
    },
    branding,
  );
}

export function runFailedEmail(
  args: {
    teamName?: string;
    automationName: string;
    stepName?: string;
    message: string;
    retries: number;
    runUrl: string;
    settingsUrl: string;
  },
  branding: Branding,
) {
  const automation = oneLine(args.automationName, 80);
  const tries =
    args.retries === 0
      ? "It was not tried again."
      : `It was tried again ${args.retries} ${args.retries === 1 ? "time" : "times"} first.`;
  return compose(
    `Run failed: ${automation}`,
    {
      heading: `A run of ${automation} failed`,
      paragraphs: [
        `${args.stepName ? `The step "${oneLine(args.stepName, 80)}" failed` : "A step failed"}${args.teamName ? ` in ${oneLine(args.teamName, 60)}` : ""}. ${tries}`,
        `What went wrong: ${oneLine(args.message, 600)}`,
      ],
      button: { label: "Open the run", url: args.runUrl },
      reason: "You get this because you are on the team.",
      settingsUrl: args.settingsUrl,
    },
    branding,
  );
}

export function approvalWaitingEmail(
  args: {
    teamName?: string;
    automationName: string;
    stepName?: string;
    /** What the run is waiting for, such as when it decides by itself. */
    note: string;
    runUrl: string;
    settingsUrl: string;
  },
  branding: Branding,
) {
  const automation = oneLine(args.automationName, 80);
  const step = args.stepName ? oneLine(args.stepName, 80) : "Approval";
  return compose(
    `Waiting for your approval: ${automation}`,
    {
      heading: `${automation} is waiting for you`,
      paragraphs: [
        `A run reached the step "${step}"${args.teamName ? ` in ${oneLine(args.teamName, 60)}` : ""} and is paused until someone approves or rejects it.`,
        oneLine(args.note, 300),
      ],
      button: { label: "Review it", url: args.runUrl },
      reason: "You get this because you were asked to review.",
      settingsUrl: args.settingsUrl,
    },
    branding,
  );
}

export function approvalTimedOutEmail(
  args: {
    teamName?: string;
    automationName: string;
    stepName?: string;
    /** What it decided, in a sentence, such as "Nobody decided within 1 day, so it was rejected." */
    outcome: string;
    runUrl: string;
    settingsUrl: string;
  },
  branding: Branding,
) {
  const automation = oneLine(args.automationName, 80);
  const step = args.stepName ? oneLine(args.stepName, 80) : "Approval";
  return compose(
    `An approval ran out of time: ${automation}`,
    {
      heading: `Nobody decided ${automation} in time`,
      paragraphs: [
        `The step "${step}"${args.teamName ? ` in ${oneLine(args.teamName, 60)}` : ""} reached its time limit and decided by itself.`,
        oneLine(args.outcome, 300),
      ],
      button: { label: "Open the run", url: args.runUrl },
      reason: "You get this because you were asked to review.",
      settingsUrl: args.settingsUrl,
    },
    branding,
  );
}

export function mentionEmail(
  args: {
    teamName?: string;
    from: string;
    reviewTitle: string;
    comment: string;
    reviewUrl: string;
    settingsUrl: string;
  },
  branding: Branding,
) {
  const from = oneLine(args.from, 60);
  const review = oneLine(args.reviewTitle, 80);
  return compose(
    `${from} mentioned you in ${review}`,
    {
      heading: `${from} mentioned you`,
      paragraphs: [
        `In the review "${review}"${args.teamName ? ` in ${oneLine(args.teamName, 60)}` : ""}:`,
      ],
      quote: oneLine(args.comment, 600),
      button: { label: "Open the review", url: args.reviewUrl },
      settingsUrl: args.settingsUrl,
    },
    branding,
  );
}

/** A client said something through a review's share link: a comment or their verdict. */
export function clientFeedbackEmail(
  args: {
    teamName?: string;
    from: string;
    reviewTitle: string;
    feedback: string;
    reviewUrl: string;
    settingsUrl: string;
  },
  branding: Branding,
) {
  const from = oneLine(args.from, 60);
  const review = oneLine(args.reviewTitle, 80);
  return compose(
    `${from} left feedback on ${review}`,
    {
      heading: `${from} left feedback`,
      paragraphs: [
        `${from} opened the link to the review "${review}"${args.teamName ? ` from ${oneLine(args.teamName, 60)}` : ""}:`,
      ],
      quote: oneLine(args.feedback, 600),
      button: { label: "Open the review", url: args.reviewUrl },
      settingsUrl: args.settingsUrl,
    },
    branding,
  );
}

/** A new version went into a project's slot and is waiting in its review room. */
export function readyForReviewEmail(
  args: {
    teamName?: string;
    from: string;
    projectName: string;
    slot: string;
    reviewUrl: string;
    settingsUrl: string;
  },
  branding: Branding,
) {
  const project = oneLine(args.projectName, 80);
  const slot = oneLine(args.slot, 80);
  return compose(
    `${slot} in ${project} is ready for review`,
    {
      heading: `${slot} is ready for review`,
      paragraphs: [
        `${oneLine(args.from, 60)} added a new version of "${slot}" to the project "${project}"${args.teamName ? ` in ${oneLine(args.teamName, 60)}` : ""}.`,
      ],
      button: { label: "Open the review", url: args.reviewUrl },
      settingsUrl: args.settingsUrl,
    },
    branding,
  );
}

export function clipFinishedEmail(
  args: {
    teamName?: string;
    automationName: string;
    summary: string;
    runUrl: string;
    settingsUrl: string;
  },
  branding: Branding,
) {
  const automation = oneLine(args.automationName, 80);
  return compose(
    `New files from ${automation}`,
    {
      heading: `${automation} finished`,
      paragraphs: [
        `${oneLine(args.summary, 300)}${args.teamName ? ` In ${oneLine(args.teamName, 60)}.` : ""}`,
      ],
      button: { label: "Open the run", url: args.runUrl },
      settingsUrl: args.settingsUrl,
    },
    branding,
  );
}

export function footageProblemEmail(
  args: {
    teamName?: string;
    automationName: string;
    /** The summary on its first line, then one line per file. */
    message: string;
    runUrl: string;
    settingsUrl: string;
  },
  branding: Branding,
) {
  const automation = oneLine(args.automationName, 80);
  const [summary, ...files] = args.message.split("\n");
  return compose(
    `Footage needs another look in ${automation}`,
    {
      heading: "Footage needs another look",
      paragraphs: [
        `${oneLine(summary ?? "", 300)}${args.teamName ? ` In ${oneLine(args.teamName, 60)}.` : ""}`,
        ...files.slice(0, 10).map((line) => oneLine(line, 400)),
      ],
      button: { label: "Open the run", url: args.runUrl },
      settingsUrl: args.settingsUrl,
    },
    branding,
  );
}

export function rightsEndingEmail(
  args: {
    teamName?: string;
    creator: string;
    client?: string;
    summary: string;
    creatorsUrl: string;
    settingsUrl: string;
  },
  branding: Branding,
) {
  const creator = oneLine(args.creator, 80);
  const title = args.client
    ? `${creator}'s rights for ${oneLine(args.client, 80)} end soon`
    : `Usage rights for ${creator} end soon`;
  return compose(
    title,
    {
      heading: title,
      paragraphs: [
        `${oneLine(args.summary, 300)}${args.teamName ? ` In ${oneLine(args.teamName, 60)}.` : ""}`,
      ],
      button: { label: "Open the creator", url: args.creatorsUrl },
      settingsUrl: args.settingsUrl,
    },
    branding,
  );
}

/** One line in a daily summary. */
export type DigestItem = { title: string; detail?: string; url: string };

export function digestEmail(
  args: { teamName?: string; items: DigestItem[]; settingsUrl: string },
  branding: Branding,
) {
  const count = args.items.length;
  const shown = args.items.slice(0, 50);
  const team = args.teamName ? ` in ${oneLine(args.teamName, 60)}` : "";
  return compose(
    `Your daily summary: ${count} ${count === 1 ? "thing" : "things"} to know${team}`,
    {
      heading: `${count} ${count === 1 ? "thing" : "things"} since your last summary`,
      paragraphs: [
        `Here is what happened${team}.`,
        ...(count > shown.length
          ? [`The first ${shown.length} are below; the rest are in your Inbox.`]
          : []),
      ],
      items: shown.map((item) => ({
        title: oneLine(item.title, 160),
        ...(item.detail ? { detail: oneLine(item.detail, 240) } : {}),
        url: item.url,
      })),
      reason:
        "You get one summary a day because you chose it. You can get emails as they happen instead.",
      settingsUrl: args.settingsUrl,
    },
    branding,
  );
}

export function testEmail(args: { teamName?: string }, branding: Branding) {
  return compose(
    "Email is working",
    {
      heading: "Email is working",
      paragraphs: [
        `This is a test from ${branding.appName}${args.teamName ? `, sent by ${oneLine(args.teamName, 60)}` : ""}. Alerts, sign-in emails and team invitations will arrive from this address.`,
      ],
    },
    branding,
  );
}

/**
 * Sent once, when someone makes their first team. Points at the three things that get a
 * first video through, and says how long the free trial runs when there is one.
 */
export function welcomeEmail(
  args: {
    name?: string;
    teamName: string;
    /** Whole days of free trial, or null when the team has none. */
    trialDays: number | null;
    homeUrl: string;
    uploadsUrl: string;
    readyMadeUrl: string;
    brandUrl: string;
  },
  branding: Branding,
) {
  const app = branding.appName;
  const team = oneLine(args.teamName, 60);
  const trial =
    args.trialDays === null
      ? ""
      : ` Your free trial runs for ${args.trialDays} ${args.trialDays === 1 ? "day" : "days"}, and no card is needed.`;
  return compose(
    `Welcome to ${app}`,
    {
      heading: args.name ? `Welcome to ${app}, ${oneLine(args.name, 40)}` : `Welcome to ${app}`,
      paragraphs: [`Your team ${team} is ready.${trial}`, "Three things get your first video out:"],
      items: [
        {
          title: "Upload a video",
          detail: "It is transcribed as soon as it lands, ready for clips and captions.",
          url: args.uploadsUrl,
        },
        {
          title: "Start from a ready-made automation",
          detail: "Pick one, switch it on, and it runs by itself on every new video.",
          url: args.readyMadeUrl,
        },
        {
          title: "Set your brand once",
          detail: "Your logo, colour, intro and outro go on what it makes.",
          url: args.brandUrl,
        },
      ],
      button: { label: `Open ${app}`, url: args.homeUrl },
    },
    branding,
  );
}

/** Sent to a team's owner a day before its free trial ends. */
export function trialEndingEmail(
  args: { name?: string; teamName: string; buyUrl: string | null; homeUrl: string },
  branding: Branding,
) {
  const app = branding.appName;
  const team = oneLine(args.teamName, 60);
  return compose(
    `Your ${app} trial ends tomorrow`,
    {
      heading: "Your free trial ends tomorrow",
      paragraphs: [
        `${args.name ? `Hi ${oneLine(args.name, 60)}, t` : "T"}he free trial for ${team} ends in a day.`,
        `After that, everything you made is kept, but automations and the agent stop starting new work until you have ${app}.`,
      ],
      button: args.buyUrl
        ? { label: `Get ${app}`, url: args.buyUrl }
        : { label: `Open ${app}`, url: args.homeUrl },
      footnote: "You get this once, because you made this team.",
    },
    branding,
  );
}

/** Sent to a team's owner when its free trial has ended. */
export function trialEndedEmail(
  args: { name?: string; teamName: string; buyUrl: string | null; homeUrl: string },
  branding: Branding,
) {
  const app = branding.appName;
  const team = oneLine(args.teamName, 60);
  return compose(
    `Your ${app} trial has ended`,
    {
      heading: "Your free trial has ended",
      paragraphs: [
        `${args.name ? `Hi ${oneLine(args.name, 60)}, t` : "T"}he free trial for ${team} is over, so nothing new starts.`,
        `Everything you made is kept, and it all starts again once you have ${app}.`,
      ],
      button: args.buyUrl
        ? { label: `Get ${app}`, url: args.buyUrl }
        : { label: `Open ${app}`, url: args.homeUrl },
      footnote: "You get this once, because you made this team.",
    },
    branding,
  );
}

/**
 * Adds one-click unsubscribe to an email people can opt out of: the List-Unsubscribe and
 * List-Unsubscribe-Post headers Gmail and Yahoo show as an Unsubscribe button (RFC 8058),
 * and a plain link in the footer. The link alone switches the email off, no sign-in.
 */
export function withUnsubscribe(email: Composed, url: string): Composed {
  const link = ` <a href="${escapeHtml(url)}" style="color:${MUTE};text-decoration:underline;">Unsubscribe</a>`;
  return {
    ...email,
    html: email.html.includes(UNSUBSCRIBE_SLOT)
      ? email.html.replace(UNSUBSCRIBE_SLOT, ` &middot;${link}`)
      : email.html.replace(
          "</body>",
          `<p style="text-align:center;font-size:12px;">${link}</p></body>`,
        ),
    text: `${email.text}\nUnsubscribe: ${url}`,
    headers: {
      ...email.headers,
      "List-Unsubscribe": `<${url}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}
