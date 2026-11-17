// The emails this app sends, written once as plain data: a subject, a text version and
// an HTML version. Nothing here sends anything.

export type Composed = { subject: string; text: string; html: string };

export type Branding = {
  /** Shown as the sender's name and in the footer. */
  appName: string;
};

export const DEFAULT_APP_NAME = "NCA Toolkit Dashboard";

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
  button?: { label: string; url: string };
  footnote?: string;
};

function compose(subject: string, layout: Layout, branding: Branding): Composed {
  const { heading, paragraphs, button, footnote } = layout;
  const text = [
    heading,
    "",
    ...paragraphs.flatMap((paragraph) => [paragraph, ""]),
    ...(button ? [`${button.label}: ${button.url}`, ""] : []),
    ...(footnote ? [footnote, ""] : []),
    `Sent by ${branding.appName}.`,
  ].join("\n");

  const p = (content: string, style = "") =>
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#27272a;${style}">${content}</p>`;
  const html = [
    "<!doctype html>",
    '<html lang="en"><body style="margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">',
    '<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e4e4e7;border-radius:12px;padding:32px;">',
    `<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#09090b;">${escapeHtml(heading)}</h1>`,
    ...paragraphs.map((paragraph) => p(escapeHtml(paragraph))),
    ...(button
      ? [
          `<p style="margin:24px 0;"><a href="${escapeHtml(button.url)}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:10px 18px;border-radius:8px;">${escapeHtml(button.label)}</a></p>`,
          p(
            `If the button does not work, open this link: <a href="${escapeHtml(button.url)}" style="color:#2563eb;word-break:break-all;">${escapeHtml(button.url)}</a>`,
            "font-size:13px;color:#71717a;",
          ),
        ]
      : []),
    ...(footnote ? [p(escapeHtml(footnote), "font-size:13px;color:#71717a;")] : []),
    "</div>",
    `<p style="max-width:520px;margin:16px auto 0;font-size:12px;color:#a1a1aa;text-align:center;">Sent by ${escapeHtml(branding.appName)}.</p>`,
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
        `${args.name ? `Hi ${oneLine(args.name, 60)}, t` : "T"}hanks for creating an account. Confirm this is your address so we can reach you about your automations.`,
      ],
      button: { label: "Confirm email address", url: args.url },
      footnote: "If you did not create an account, you can ignore this email.",
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
      footnote: `You get this because you are on the team. To stop these emails, switch them off in Settings: ${args.settingsUrl}`,
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
