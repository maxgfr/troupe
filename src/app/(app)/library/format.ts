// Words and figures the library's pages share.

export type ItemKind = "video" | "audio" | "image" | "pdf" | "text" | "article";
export type ItemStatus = "queued" | "analyzing" | "ready" | "failed";

export const KIND_LABELS: Record<ItemKind, string> = { video: "Video", audio: "Sound", image: "Picture", pdf: "PDF", text: "Text", article: "Article" };

// 72.6 → "1:12"; 3723 → "1:02:03".
export function clock(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "";
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export const STATUS_LABELS: Record<ItemStatus, string> = { queued: "waiting", analyzing: "reading", ready: "ready", failed: "failed" };

// A link, or text: one field takes both.
export function looksLikeLink(text: string): boolean {
  const value = text.trim();
  if (!value || /\s/.test(value)) return false;
  return /^https?:\/\//i.test(value) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(value);
}

export function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

export const IDEA_LABELS = { ideas: "In this style", remix: "Hook remix", script: "Script", repurpose: "Repurposed" } as const;
