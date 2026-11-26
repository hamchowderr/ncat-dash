import { type Branding, isEmailAddress } from "@takewon/email";

/**
 * How an email is signed: the app's name, and the inbox a person answers at
 * (EMAIL_REPLY_TO), where replies go and which the footer names. An address that is not
 * one plain email address is left out, so nothing is sent with a broken reply-to.
 */
export function emailBranding(
  appName: string,
  env: Record<string, string | undefined> = process.env,
): Branding {
  const reply = env.EMAIL_REPLY_TO?.trim();
  return { appName, ...(reply && isEmailAddress(reply) ? { supportEmail: reply } : {}) };
}
