// The emails this app sends, written once as plain data: a subject, a text version and
// an HTML version. Nothing here sends anything.

export type Composed = {
  subject: string;
  text: string;
  html: string;
  /** Extra headers to send with it, such as one-click unsubscribe. */
  headers?: Record<string, string>;
  /** Where a reply goes, when it should reach a person rather than the sending address. */
  replyTo?: string;
};

/** Where `withUnsubscribe` puts its link in an email's footer. */
const UNSUBSCRIBE_SLOT = "<!--unsubscribe-->";

export type Branding = {
  /** Shown as the sender's name and in the footer. */
  appName: string;
  /**
   * The address a person answers at (EMAIL_REPLY_TO). Replies go there, and the footer
   * says so. Left out: no help line.
   */
  supportEmail?: string;
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

export type Layout = {
  heading: string;
  paragraphs: string[];
  /** Words someone wrote, such as a comment, set apart from ours. */
  quote?: string;
  /** Linked lines, such as the items of a daily summary. */
  items?: { title: string; detail?: string; url: string }[];
  button?: { label: string; url: string };
  /**
   * Pictures of the person's own work, such as a moving preview of each clip, each linked
   * to where it is. Hosted images with alt text: a mail app that holds images back shows
   * the words instead.
   */
  pictures?: { src: string; alt: string; url: string }[];
  /** A signed line from a person, set under the button. Only in our own emails. */
  signoff?: { lines: string[]; name: string; role: string };
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

/** Where the company is, as the law on marketing email (CAN-SPAM) asks every email to say. */
export const COMPANY_ADDRESS = "10521 West Zamora Ave, Los Angeles, CA 90002";

/**
 * The mark beside the name: a violet square with a play shape, drawn in HTML rather than
 * an image, so it shows even where a mail app holds images back.
 */
function mark(): string {
  return `<td style="width:28px;height:28px;background:${ACCENT};border-radius:8px;text-align:center;vertical-align:middle;color:#ffffff;font-size:12px;line-height:28px;font-family:${FONT};">&#9654;</td>`;
}

export function compose(subject: string, layout: Layout, branding: Branding): Composed {
  const { heading, paragraphs, quote, items, button, footnote, reason, settingsUrl } = layout;
  const ours = branding.appName === DEFAULT_APP_NAME;
  const pictures = (layout.pictures ?? []).slice(0, 3);
  const signoff = ours ? layout.signoff : undefined;
  const support = branding.supportEmail;
  const helpText = support
    ? `Questions? Reply to this email or write to ${support}.`
    : null;
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
    ...(signoff ? [...signoff.lines.flatMap((line) => [line, ""]), signoff.name, signoff.role, ""] : []),
    ...(footnote ? [footnote, ""] : []),
    "--",
    ...(helpText ? [helpText] : []),
    ...(reason ? [reason] : []),
    ...(settingsUrl ? [`Notification settings: ${settingsUrl}`] : []),
    ...(ours
      ? [`${branding.appName}. ${MOTTO} Made by ${COMPANY}.`, COMPANY_ADDRESS]
      : [`Sent by ${branding.appName}.`]),
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
    ...(pictures.length
      ? [
          '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 8px;"><tr>',
          ...pictures.map(
            (picture, index) =>
              `<td style="padding:0 ${index < pictures.length - 1 ? 10 : 0}px 0 0;vertical-align:top;"><a href="${escapeHtml(picture.url)}" style="text-decoration:none;"><img src="${escapeHtml(picture.src)}" width="150" alt="${escapeHtml(picture.alt)}" style="display:block;width:150px;max-width:100%;height:auto;border:0;border-radius:10px;background:#f4f4f7;color:${MUTE};font-size:13px;"></a></td>`,
          ),
          "</tr></table>",
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
    ...(signoff
      ? [
          ...signoff.lines.map((line) => p(escapeHtml(line))),
          p(
            `<strong style="color:${INK};">${escapeHtml(signoff.name)}</strong><br>${escapeHtml(signoff.role)}`,
            "margin:0 0 16px;",
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
    ...(support
      ? [
          `<p style="margin:0 0 8px;">Questions? Reply to this email or write to ${link(`mailto:${support}`, support)}.</p>`,
        ]
      : []),
    ours
      ? `<p style="margin:0;">${escapeHtml(branding.appName)}. ${escapeHtml(MOTTO)}<br>Made by ${escapeHtml(COMPANY)}, ${escapeHtml(COMPANY_ADDRESS)}.</p>`
      : `<p style="margin:0;">Sent by ${escapeHtml(branding.appName)}.</p>`,
    "</div>",
    "</div>",
    "</body></html>",
  ].join("");

  return {
    subject: oneLine(subject, 200),
    text,
    html,
    ...(support ? { replyTo: support } : {}),
  };
}

/** Who signs the welcome email in Takewon's own copy. */
export const FOUNDER = { name: "Chowderr", role: "Founder, Takewon" } as const;

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

/** The agent answered the question the person tagged it with in a review comment. */
export function agentAnswerEmail(
  args: {
    teamName?: string;
    reviewTitle: string;
    answer: string;
    reviewUrl: string;
    settingsUrl: string;
  },
  branding: Branding,
) {
  const review = oneLine(args.reviewTitle, 80);
  return compose(
    `The agent answered you in ${review}`,
    {
      heading: "The agent answered your question",
      paragraphs: [
        `In the review "${review}"${args.teamName ? ` in ${oneLine(args.teamName, 60)}` : ""}:`,
        `"${oneLine(args.answer, 600)}"`,
      ],
      button: { label: "Open the review", url: args.reviewUrl },
      footnote: `To stop these emails, change your notification settings: ${args.settingsUrl}`,
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
      signoff: {
        lines: [
          "I built Takewon so your videos come out as clips ready to post, without an afternoon in an editor. If anything gets in your way, just reply: it comes to me.",
        ],
        ...FOUNDER,
      },
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

/** The steps of the trial's tips, sent only to someone who has not done the thing yet. */
export type TrialTip = "first_upload" | "clips_ready" | "every_upload" | "come_back";

const TIP_FOOTNOTE = "You get a few of these tips during your free trial.";

/**
 * A tip during the free trial (convex/trialTips.ts decides whether it goes): one next
 * step each, toward a first finished clip and then toward it running by itself.
 */
export function trialTipEmail(
  args: {
    tip: TrialTip;
    name?: string;
    teamName: string;
    uploadsUrl: string;
    readyMadeUrl: string;
    /** For clips_ready: the run whose files are ready. */
    runUrl?: string;
    /** For clips_ready: a moving preview of up to three of the clips. */
    previews?: string[];
    buyUrl: string | null;
    homeUrl: string;
    settingsUrl: string;
  },
  branding: Branding,
) {
  const app = branding.appName;
  const hi = args.name ? `Hi ${oneLine(args.name, 60)}, ` : "";
  const shared = {
    footnote: TIP_FOOTNOTE,
    reason: "You get these because you started a free trial.",
    settingsUrl: args.settingsUrl,
  };
  if (args.tip === "first_upload") {
    return compose(
      "Your first video is one click away",
      {
        heading: "Your first video is one click away",
        paragraphs: [
          `${hi}drop a video into ${app} and it is transcribed as soon as it lands.`,
          "From there, one ready-made automation turns it into captioned vertical clips.",
        ],
        button: { label: "Upload a video", url: args.uploadsUrl },
        ...shared,
      },
      branding,
    );
  }
  if (args.tip === "clips_ready") {
    return compose(
      "Your first clips are ready",
      {
        heading: "Your first clips are ready",
        paragraphs: [
          `${hi}your first run in ${oneLine(args.teamName, 60)} is done and its files are in Files.`,
          "Next, try another ready-made automation on the same video: captions in your brand, a thumbnail, or best moments.",
        ],
        pictures: (args.previews ?? []).map((src, index) => ({
          src,
          alt: `Preview of clip ${index + 1}`,
          url: args.runUrl ?? args.homeUrl,
        })),
        button: { label: "See your clips", url: args.runUrl ?? args.homeUrl },
        ...shared,
      },
      branding,
    );
  }
  if (args.tip === "every_upload") {
    return compose(
      "Let it run on every upload",
      {
        heading: "Let it run on every upload",
        paragraphs: [
          `${hi}switch on a ready-made automation and every new video gets the same treatment, with nobody pressing anything.`,
          "Pick one, switch it on, and drop in your next video.",
        ],
        button: { label: "Pick a ready-made automation", url: args.readyMadeUrl },
        ...shared,
      },
      branding,
    );
  }
  return compose(
    `Still want your content social media ready?`,
    {
      heading: MOTTO,
      paragraphs: [
        `${hi}your free trial of ${app} has ended, and everything you made in ${oneLine(args.teamName, 60)} is still there.`,
        `It all starts again once you have ${app}.`,
      ],
      button: args.buyUrl
        ? { label: `Get ${app}`, url: args.buyUrl }
        : { label: `Open ${app}`, url: args.homeUrl },
      ...shared,
    },
    branding,
  );
}

/** Sent to a team's owner once the team has bought. */
export function thanksEmail(
  args: { name?: string; teamName: string; homeUrl: string },
  branding: Branding,
) {
  const app = branding.appName;
  return compose(
    `Thanks for getting ${app}`,
    {
      heading: `Thanks for getting ${app}`,
      paragraphs: [
        `${args.name ? `Hi ${oneLine(args.name, 60)}, ` : ""}${oneLine(args.teamName, 60)} is all set. Automations and the agent run again, with no trial limits.`,
        "Reply to this email if you need a hand with anything.",
      ],
      button: { label: `Open ${app}`, url: args.homeUrl },
      footnote: "You get this once, because your team bought.",
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
