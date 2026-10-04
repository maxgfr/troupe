// Same rule as the server (2.5 words per second), for live feedback while
// typing.
export function estimateSeconds(text: string): number {
  return Math.ceil(text.split(/\s+/).filter(Boolean).length / 2.5);
}
