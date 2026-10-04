import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

// Credentials at rest: AES-256-GCM, the row identity bound in as additional
// authenticated data so a ciphertext cannot be replayed onto another row.
// The key comes from TROUPE_SECRET (HKDF) or, failing that, a random key file
// generated once in the data directory. Losing both makes saved keys
// unreadable — the UI then asks for them again instead of crashing.

export class SecretUnavailableError extends Error {
  constructor(message = "This saved secret can no longer be decrypted. Enter it again.") {
    super(message);
    this.name = "SecretUnavailableError";
  }
}

export interface SecretBox {
  // Short public identifier of the key, stored next to ciphertexts so a key
  // change is detected without attempting a decryption.
  fingerprint: string;
  seal(plaintext: string, aad: string): string;
  open(sealed: string, aad: string): string;
}

const VERSION = "v1";

export function createSecretBox(key: Buffer): SecretBox {
  if (key.length !== 32) throw new Error("secret box key must be 32 bytes");
  return {
    fingerprint: createHmac("sha256", key).update("troupe-key-fingerprint").digest("hex").slice(0, 16),
    seal(plaintext, aad) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(aad));
      const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      return `${VERSION}:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64")}`;
    },
    open(sealed, aad) {
      const [version, payload] = sealed.split(":", 2);
      if (version !== VERSION || !payload) throw new SecretUnavailableError();
      const raw = Buffer.from(payload, "base64");
      if (raw.length < 28) throw new SecretUnavailableError();
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
        decipher.setAAD(Buffer.from(aad));
        decipher.setAuthTag(raw.subarray(12, 28));
        return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
      } catch {
        throw new SecretUnavailableError();
      }
    },
  };
}

function keyFromEnv(secret: string) {
  return Buffer.from(hkdfSync("sha256", secret, "troupe", "troupe-secrets-v1", 32));
}

function keyFromFile(): Buffer {
  const dir = resolve(process.env.TROUPE_DATA_DIR ?? "data");
  const file = join(dir, "secret.key");
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true });
    try {
      // "wx": never overwrite a key another process just wrote.
      writeFileSync(file, `${randomBytes(32).toString("hex")}\n`, { mode: 0o600, flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  const hex = readFileSync(file, "utf8").trim();
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new SecretUnavailableError(`${file} is not a valid key file. Restore it from your backup or set TROUPE_SECRET.`);
  return Buffer.from(hex, "hex");
}

let cached: SecretBox | undefined;

export function loadSecretBox(): SecretBox {
  if (cached) return cached;
  const secret = process.env.TROUPE_SECRET;
  if (secret) {
    cached = createSecretBox(keyFromEnv(secret));
  } else if (process.env.VERCEL) {
    // Serverless file systems are ephemeral: a generated key would vanish.
    throw new SecretUnavailableError("Set TROUPE_SECRET to store API keys on this deployment.");
  } else {
    cached = createSecretBox(keyFromFile());
  }
  return cached;
}

export function resetSecretBoxCache() {
  cached = undefined;
}
