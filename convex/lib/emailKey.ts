import { DISPOSABLE_DOMAINS } from "./disposableDomains";

// Gmail ignores dots in the name, and googlemail.com is the same mailbox.
const DOTLESS = new Set(["gmail.com", "googlemail.com"]);

/**
 * One mailbox however it is written, so the same person can't get a second free trial
 * by adding dots or a "+tag": "Maya.Ortiz+2@GoogleMail.com" is "mayaortiz@gmail.com".
 * Null for something that is not an email address.
 */
export function emailKey(email: string): string | null {
  const at = email.trim().toLowerCase().lastIndexOf("@");
  if (at <= 0) return null;
  const address = email.trim().toLowerCase();
  let name = address.slice(0, at);
  let domain = address.slice(at + 1);
  if (!domain) return null;
  name = name.split("+")[0]!;
  if (DOTLESS.has(domain)) {
    name = name.replace(/\./g, "");
    domain = "gmail.com";
  }
  return name ? `${name}@${domain}` : null;
}

let disposable: Set<string> | null = null;

/**
 * Whether an address is at a throwaway email service (mailinator.com and ten thousand
 * like it), or at a domain the operator listed in BLOCKED_EMAIL_DOMAINS (comma-separated).
 * A subdomain of a listed domain counts too.
 */
export function isThrowawayEmail(
  email: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const domain = email.trim().toLowerCase().split("@").pop() ?? "";
  if (!domain) return false;
  disposable ??= new Set(DISPOSABLE_DOMAINS.split("\n"));
  const extra = (env.BLOCKED_EMAIL_DOMAINS ?? "")
    .split(",")
    .map((one) => one.trim().toLowerCase())
    .filter(Boolean);
  const parts = domain.split(".");
  for (let i = 0; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join(".");
    if (disposable.has(candidate) || extra.includes(candidate)) return true;
  }
  return false;
}
