// Encrypts secrets (toolkit keys, later platform tokens) before they are stored.
// AES-256-GCM with a key derived from CONNECTIONS_SECRET. Uses Web Crypto, so it runs
// in Convex's default runtime. Call it from actions only: it needs random bytes.

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function getKey(): Promise<CryptoKey> {
  const secret = process.env.CONNECTIONS_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "CONNECTIONS_SECRET is not set (or is shorter than 32 characters). " +
        "Set it with: npx convex env set CONNECTIONS_SECRET $(openssl rand -base64 32)",
    );
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** Returns "v1.<iv>.<ciphertext>", both base64. */
export async function encryptSecret(plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await getKey(),
    new TextEncoder().encode(plain),
  );
  return `v1.${toBase64(iv)}.${toBase64(new Uint8Array(cipher))}`;
}

export async function decryptSecret(stored: string): Promise<string> {
  const [version, iv, cipher] = stored.split(".");
  if (version !== "v1" || !iv || !cipher) throw new Error("Unrecognised secret format");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(iv) },
    await getKey(),
    fromBase64(cipher),
  );
  return new TextDecoder().decode(plain);
}
