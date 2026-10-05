// `bytes` random bytes as lowercase hex. Web Crypto, so it also runs in a
// browser (the browser edition runs the adapters and the model service).
export function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
}
