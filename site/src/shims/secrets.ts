import type * as Real from "~/server/settings/secrets";

// Stands in for src/server/settings/secrets.ts in the browser edition.
//
// Provider keys (OpenRouter, fal.ai…) are sealed with AES-256-GCM through
// WebCrypto, under a key the browser generates once and keeps in its own
// IndexedDB database (troupe-keys) as a non-extractable CryptoKey: the page
// can use it, nothing can read it out, and it is never part of a backup. A
// backup imported elsewhere, or the key's database cleared, leaves the saved
// keys unreadable: Settings then asks for them again.
//
// Local model tokens are not offered here (a web page cannot reach model
// servers on the visitor's machine), so the synchronous box stays refused.

const NEEDS_SELF_HOSTED = "Tokens for model servers are saved by the self-hosted studio only, on your own server.";

export class SecretUnavailableError extends Error {
  constructor(message = "This saved secret can no longer be decrypted. Enter it again.") {
    super(message);
    this.name = "SecretUnavailableError";
  }
}

export type SecretBox = Real.SecretBox;
export type ProviderSecretBox = Real.ProviderSecretBox;

export function createSecretBox(): SecretBox {
  throw new SecretUnavailableError(NEEDS_SELF_HOSTED);
}

export function loadSecretBox(): SecretBox {
  throw new SecretUnavailableError(NEEDS_SELF_HOSTED);
}

export const KEY_DATABASE = "troupe-keys";
const STORE = "keys";
// The fingerprint of this browser's key, readable at once (the key itself is
// read from IndexedDB on first use).
export const FINGERPRINT_ITEM = "troupe.secret-box";
const VERSION = "w1";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(KEY_DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB is unavailable."));
  });
}

function run<T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = act(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(request.result);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error ?? new Error("IndexedDB refused the request."));
        };
      }),
  );
}

function fingerprint(): string {
  let id = localStorage.getItem(FINGERPRINT_ITEM);
  if (!id || !/^[0-9a-f]{16}$/.test(id)) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(FINGERPRINT_ITEM, id);
  }
  return id;
}

// This browser's key: read once, made on first use.
const keys = new Map<string, Promise<CryptoKey | null>>();
function cryptoKey(id: string, create: boolean): Promise<CryptoKey | null> {
  const cached = keys.get(id);
  if (cached) return cached;
  const loading = (async () => {
    const stored = await run<CryptoKey | undefined>("readonly", (s) => s.get(id));
    if (stored) return stored;
    if (!create) return null;
    const made = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    await run("readwrite", (s) => s.put(made, id));
    return made;
  })();
  keys.set(id, loading);
  loading.then(
    (key) => {
      if (!key) keys.delete(id);
    },
    () => keys.delete(id),
  );
  return loading;
}

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export function loadProviderSecretBox(): ProviderSecretBox {
  const id = fingerprint();
  return {
    fingerprint: id,
    async seal(plaintext, aad) {
      const key = (await cryptoKey(id, true))!;
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const body = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) },
          key,
          new TextEncoder().encode(plaintext),
        ),
      );
      const out = new Uint8Array(iv.length + body.length);
      out.set(iv);
      out.set(body, iv.length);
      return `${VERSION}:${toBase64(out)}`;
    },
    async open(sealed, aad) {
      const [version, payload] = sealed.split(":", 2);
      if (version !== VERSION || !payload) throw new SecretUnavailableError();
      const key = await cryptoKey(id, false);
      if (!key) throw new SecretUnavailableError();
      try {
        const raw = fromBase64(payload);
        const plain = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: raw.subarray(0, 12), additionalData: new TextEncoder().encode(aad) },
          key,
          raw.subarray(12),
        );
        return new TextDecoder().decode(plain);
      } catch {
        throw new SecretUnavailableError();
      }
    },
  };
}

// Forget this browser's key (Delete all local data): every saved key goes too.
export async function forgetBrowserSecretKey(): Promise<void> {
  keys.clear();
  localStorage.removeItem(FINGERPRINT_ITEM);
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(KEY_DATABASE);
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
}

export function resetSecretBoxCache() {
  keys.clear();
}

// Fails the typecheck when the real module's exports change shape.
({
  SecretUnavailableError,
  createSecretBox,
  loadSecretBox,
  loadProviderSecretBox,
  resetSecretBoxCache,
}) satisfies typeof Real;
