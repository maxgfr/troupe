import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

// Videos from the platforms (YouTube, TikTok, Instagram, Vimeo, X…) come
// through yt-dlp, an optional program (TROUPE_YTDLP_PATH; the Docker image
// has it). It runs with an argument list, never a shell: the link is one
// argument after "--", so it can never be read as an option. No config files
// or plugins are loaded, playlists are refused, and size and length are
// capped. Only the platforms' own extractors run: the generic one would
// fetch whatever page a link, or a redirect on a platform, points at. The
// requests yt-dlp makes are not checked against private addresses the way
// the studio's own are (public-url.ts); TROUPE_YTDLP_PROXY sends them
// through a proxy that can. The download lands in a folder of its own,
// removed afterwards.

const PLATFORMS = [
  "youtube.com",
  "youtu.be",
  "tiktok.com",
  "instagram.com",
  "vimeo.com",
  "x.com",
  "twitter.com",
  "facebook.com",
  "fb.watch",
  "dailymotion.com",
  "twitch.tv",
  "soundcloud.com",
  "threads.net",
  "threads.com",
  "bilibili.com",
];

export function isVideoPlatform(url: URL): boolean {
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  return PLATFORMS.some((p) => host === p || host.endsWith(`.${p}`));
}

export interface YtDlpLimits {
  dir: string;
  maxBytes: number;
  maxDurationS: number;
  ffmpegLocation?: string;
  proxy?: string | null;
}

// What both runs share: no configuration, plugins or playlists, the
// platforms' extractors only, and the proxy if there is one.
function guardArgs(proxy: string | null | undefined): string[] {
  return ["--ignore-config", "--no-plugin-dirs", "--no-playlist", "--use-extractors", "default,-generic", "--socket-timeout", "30", ...(proxy ? ["--proxy", proxy] : [])];
}

// The video's details only (its length, whether it is live), to refuse it
// with the right reason before downloading anything.
export function ytDlpInfoArgs(url: string, options: { proxy?: string | null }): string[] {
  return [...guardArgs(options.proxy), "--dump-single-json", "--skip-download", "--", url];
}

export function ytDlpArgs(url: string, limits: YtDlpLimits): string[] {
  return [
    ...guardArgs(limits.proxy),
    "--no-exec",
    "--no-cache-dir",
    "--no-progress",
    "--no-mtime",
    "--restrict-filenames",
    "--max-filesize",
    `${Math.max(1, Math.floor(limits.maxBytes / 1024 / 1024))}M`,
    "--match-filter",
    `duration <= ${Math.floor(limits.maxDurationS)}`,
    // At most 720p: enough to read the pictures, a fraction of the size.
    "-f",
    "bv*[height<=720]+ba/b[height<=720]/b",
    "--merge-output-format",
    "mp4",
    "--write-info-json",
    "-o",
    join(limits.dir, "media.%(ext)s"),
    ...(limits.ffmpegLocation ? ["--ffmpeg-location", limits.ffmpegLocation] : []),
    "--",
    url,
  ];
}

export interface YtDlpResult {
  path: string;
  title: string;
  durationS: number | null;
  webpageUrl: string;
}

export class YtDlpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YtDlpError";
  }
}

// Only what yt-dlp needs: none of the studio's secrets reach it.
function ytDlpEnv(): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "/tmp", LANG: "C.UTF-8" } as unknown as NodeJS.ProcessEnv;
}

function run(program: string, args: string[], options: { timeoutMs: number; signal?: AbortSignal }): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { stdio: ["ignore", "pipe", "pipe"], signal: options.signal, timeout: options.timeoutMs, env: ytDlpEnv() });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      // The details of a video run to a few hundred kilobytes.
      if (stdout.length < 8_000_000) stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-20_000);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

// "2026.08.19", or null when yt-dlp is not installed.
export async function ytDlpVersion(program: string): Promise<string | null> {
  try {
    const { code, stdout } = await run(program, ["--version"], { timeoutMs: 15_000 });
    return code === 0 ? stdout.trim() : null;
  } catch {
    return null;
  }
}

const clock = (s: number) => {
  const whole = Math.round(s);
  return `${Math.floor(whole / 3600)}:${String(Math.floor((whole % 3600) / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
};

export interface VideoInfo {
  duration?: unknown;
  is_live?: unknown;
  live_status?: unknown;
  title?: unknown;
  webpage_url?: unknown;
}

// Why the library will not download this video, or null when it will.
export function videoRefusal(info: VideoInfo, maxDurationS: number): string | null {
  if (info.live_status === "is_upcoming") return "That live stream has not started yet, so its length is not known. Save it once it has ended.";
  if (info.is_live === true || info.live_status === "is_live" || info.live_status === "post_live") return "That is a live stream (or one still being processed), so its length is not known. Save it once it has ended and the platform has the full video.";
  if (typeof info.duration !== "number" || !Number.isFinite(info.duration)) return "The video's length is not known, so the library does not download it (it takes videos up to TROUPE_LIBRARY_MAX_DURATION_S). Download it yourself and upload the file.";
  if (info.duration > maxDurationS) return `The video is ${clock(info.duration)} long; the library takes up to ${clock(maxDurationS)} (TROUPE_LIBRARY_MAX_DURATION_S).`;
  return null;
}

// yt-dlp's last ERROR line, said plainly.
function explain(stderr: string): string {
  const line = stderr.split("\n").reverse().find((l) => l.startsWith("ERROR:")) ?? stderr.trim().split("\n").at(-1) ?? "";
  const said = line.replace(/^ERROR:\s*/, "").replace(/\s+/g, " ").slice(0, 300);
  if (/does not pass filter/i.test(stderr)) return "The video is longer than the library takes, or its length is not known (TROUPE_LIBRARY_MAX_DURATION_S).";
  if (/larger than max-filesize|File is larger/i.test(stderr)) return "The video is larger than the library takes (TROUPE_LIBRARY_MAX_UPLOAD_MB).";
  if (/No suitable extractor|Unsupported URL/i.test(said)) return "yt-dlp does not know that page as a video. Download the video and upload the file.";
  if (/sign in|login|private|cookies/i.test(said)) return `The platform refused the download: ${said}. Only public videos can be saved; download it yourself and upload the file.`;
  return said || "yt-dlp could not download it.";
}

async function runYtDlp(program: string, args: string[], options: { timeoutMs: number; signal?: AbortSignal }) {
  try {
    return await run(program, args, options);
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") throw new YtDlpError("yt-dlp is not installed on this server, so links to video platforms cannot be saved. Install it (docs/LIBRARY.md), or download the video and upload the file.");
    throw new YtDlpError(`yt-dlp could not run: ${(error as Error).message}`);
  }
}

export async function downloadWithYtDlp(program: string, url: string, limits: YtDlpLimits & { timeoutMs: number; signal?: AbortSignal }): Promise<YtDlpResult> {
  const details = await runYtDlp(program, ytDlpInfoArgs(url, limits), { timeoutMs: Math.min(limits.timeoutMs, 120_000), signal: limits.signal });
  if (details.code !== 0) throw new YtDlpError(explain(details.stderr));
  let about: VideoInfo = {};
  try {
    about = JSON.parse(details.stdout) as VideoInfo;
  } catch {
    throw new YtDlpError("yt-dlp did not describe the video. The link may not be a video.");
  }
  const refused = videoRefusal(about, limits.maxDurationS);
  if (refused) throw new YtDlpError(refused);
  const result = await runYtDlp(program, ytDlpArgs(url, limits), limits);
  if (result.code !== 0) throw new YtDlpError(explain(result.stderr));
  const files = await readdir(limits.dir);
  const media = files.find((f) => f.startsWith("media.") && !f.endsWith(".json") && !f.endsWith(".part"));
  if (!media) throw new YtDlpError(/does not pass filter/i.test(result.stdout + result.stderr) ? explain(result.stdout + result.stderr) : "yt-dlp finished without a video. The link may not be a video.");
  let info: { title?: unknown; duration?: unknown; webpage_url?: unknown } = {};
  try {
    info = JSON.parse(await readFile(join(limits.dir, "media.info.json"), "utf8"));
  } catch {}
  return {
    path: join(limits.dir, media),
    title: typeof info.title === "string" && info.title.trim() ? info.title.trim().slice(0, 300) : url,
    durationS: typeof info.duration === "number" && Number.isFinite(info.duration) ? info.duration : null,
    webpageUrl: typeof info.webpage_url === "string" ? info.webpage_url : url,
  };
}
