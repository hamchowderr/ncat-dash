import { getEdition } from "./edition";

// How people sign in, worked out from the deployment's settings. Kept apart from auth.ts so
// ordinary functions (settings.get) can ask without loading Better Auth.

/**
 * Whether people must confirm their email address before they can sign in. Set with
 * REQUIRE_EMAIL_VERIFICATION. On the hosted edition it is on by itself once the deployment
 * can send email (TOSEND_API_KEY and EMAIL_FROM), since a free trial for any address
 * typed in is easy to repeat; REQUIRE_EMAIL_VERIFICATION=false turns it off there too.
 */
export function requireEmailVerification(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const asked = env.REQUIRE_EMAIL_VERIFICATION?.trim();
  if (asked === "true") return true;
  if (asked === "false") return false;
  return getEdition() === "hosted" && Boolean(env.TOSEND_API_KEY?.trim() && env.EMAIL_FROM?.trim());
}

/**
 * Sign in with Google, set with GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (a Google Cloud
 * OAuth client of type "Web application", redirect URI `SITE_URL/api/auth/callback/google`).
 * Without both, the sign-in page shows email and password only.
 */
export function socialProviders(env: Record<string, string | undefined> = process.env) {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return {};
  return { google: { clientId, clientSecret, prompt: "select_account" as const } };
}
