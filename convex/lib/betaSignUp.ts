// The website's "Join the beta" form posts here server to server (POST /beta/apply), with
// `Authorization: Bearer <BETA_SIGNUP_SECRET>`. Nothing is accepted without that secret,
// so the list can't be filled from a browser.

const encoder = new TextEncoder();

async function digest(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}

/** Whether the request carries BETA_SIGNUP_SECRET, compared in constant time. */
export async function hasBetaSecret(
  authorization: string | null,
  secret = process.env.BETA_SIGNUP_SECRET,
): Promise<boolean> {
  if (!secret || secret.length < 16 || !authorization?.startsWith("Bearer ")) return false;
  const [given, wanted] = await Promise.all([
    digest(authorization.slice("Bearer ".length).trim()),
    digest(secret),
  ]);
  let diff = 0;
  for (let index = 0; index < wanted.length; index += 1) diff |= given[index]! ^ wanted[index]!;
  return diff === 0;
}

export type BetaSignUp = {
  email: string;
  name: string;
  link?: string;
  source?: string;
  answers: { question: string; answer: string }[];
  newsletter?: boolean;
  newsletterWording?: string;
  userAgent?: string;
};

const text = (value: unknown) => (typeof value === "string" ? value : undefined);

/** The body the site sends, keeping only fields of the right shape. Null when it isn't JSON. */
export function readBetaSignUp(body: unknown): BetaSignUp | null {
  if (!body || typeof body !== "object") return null;
  const raw = body as Record<string, unknown>;
  const answers = Array.isArray(raw.answers)
    ? raw.answers
        .filter((one): one is Record<string, unknown> => !!one && typeof one === "object")
        .map((one) => ({ question: text(one.question) ?? "", answer: text(one.answer) ?? "" }))
        .filter((one) => one.question && one.answer)
    : [];
  const optional = (key: string) => {
    const value = text(raw[key]);
    return value ? { [key]: value } : {};
  };
  return {
    email: text(raw.email) ?? "",
    name: text(raw.name) ?? "",
    answers,
    ...optional("link"),
    ...optional("source"),
    ...optional("newsletterWording"),
    ...optional("userAgent"),
    ...(raw.newsletter === true ? { newsletter: true } : {}),
  };
}
