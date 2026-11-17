import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "~/lib/env";

/**
 * Secrets at rest (extension tokens, webhook signing secrets): AES-256-GCM under a key derived from `EXTENSION_SECRET`
 * (or the Clerk secret), so a copy of the database alone does not hand them out. Stored as `v1.<iv>.<tag>.<ciphertext>`, base64url.
 */
const VERSION = "v1";
const IV_BYTES = 12;

const key = () =>
  createHash("sha256")
    .update(`keep-extension-token:${env.EXTENSION_SECRET ?? env.CLERK_SECRET_KEY}`)
    .digest();

export function seal(secret: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), data]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

export function open(sealed: string): string {
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || data === undefined) throw new Error("Not a sealed extension token");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
