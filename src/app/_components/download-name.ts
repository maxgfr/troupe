// What a downloaded render is called, wherever it is downloaded from (the
// timeline or the export page): the project, the model and when it was made,
// so files from one studio tell themselves apart in a downloads folder.

function slug(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
}

const pad = (n: number) => String(n).padStart(2, "0");

export function renderFileName(input: { project?: string | null; model?: string | null; createdAt: string | Date }): string {
  const at = new Date(input.createdAt);
  const stamp = Number.isNaN(at.getTime())
    ? null
    : `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}`;
  const parts = [slug(input.project ?? ""), slug(input.model ?? ""), stamp].filter(Boolean);
  return `${parts.length ? parts.join("-") : "troupe-video"}.mp4`;
}

// A media URL that saves the file under `name` instead of playing it.
export function downloadUrl(mediaUrl: string, name: string): string {
  return `${mediaUrl}${mediaUrl.includes("?") ? "&" : "?"}download=${encodeURIComponent(name)}`;
}
