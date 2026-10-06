import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { LibraryError, type FetchedSource } from "~/modules/library";
import { extractArticle } from "./article";
import type { LibraryEnvironment } from "./config";
import { checkPublicUrl, FetchRefused, openPublicUrl, readLimited } from "./public-url";
import { downloadWithYtDlp, isVideoPlatform, YtDlpError } from "./ytdlp";

// A link saved to the library: a video platform's page goes to yt-dlp; any
// other link is fetched once, an HTML page kept as an article (its words),
// a direct video, sound, picture or PDF kept as a file. Only public
// addresses are fetched (public-url.ts).

const PAGE_BYTES = 5 * 1024 * 1024;
const FILE_DEADLINE_MS = 30 * 60_000;
const FILE_TYPES = /^(video|audio|image)\/|^application\/pdf$/;

function charsetOf(contentType: string | undefined): string {
  const charset = /charset=([\w-]+)/i.exec(contentType ?? "")?.[1]?.toLowerCase() ?? "utf-8";
  try {
    new TextDecoder(charset);
    return charset;
  } catch {
    return "utf-8";
  }
}

export async function fetchSource(
  raw: string,
  env: LibraryEnvironment,
  options: { signal?: AbortSignal } = {},
): Promise<FetchedSource> {
  const checked = checkPublicUrl(raw, { allowPrivate: env.allowPrivateUrls });
  if (!checked.ok) throw new LibraryError(checked.reason);
  const url = checked.url;

  if (isVideoPlatform(url)) {
    if (!env.ytDlpPath)
      throw new LibraryError(
        "Links to video platforms are off on this server (TROUPE_YTDLP_PATH=off). Download the video and upload the file.",
        "PRECONDITION_FAILED",
      );
    const dir = await mkdtemp(join(tmpdir(), "troupe-ytdlp-"));
    const dispose = () => rm(dir, { recursive: true, force: true });
    try {
      const video = await downloadWithYtDlp(env.ytDlpPath, url.toString(), {
        dir,
        maxBytes: env.maxUploadBytes,
        maxDurationS: env.maxDurationS,
        ffmpegLocation: env.ffmpegPath.includes("/") ? env.ffmpegPath : undefined,
        proxy: env.ytDlpProxy,
        timeoutMs: FILE_DEADLINE_MS,
        signal: options.signal,
      });
      return {
        kind: "file",
        url: video.webpageUrl,
        title: video.title,
        path: video.path,
        mimeType: "video/mp4",
        bytes: 0,
        checksum: "",
        durationS: video.durationS,
        dispose,
      };
    } catch (error) {
      await dispose();
      if (error instanceof YtDlpError) throw new LibraryError(error.message, "PRECONDITION_FAILED");
      throw error;
    }
  }

  let response: Awaited<ReturnType<typeof openPublicUrl>>;
  try {
    response = await openPublicUrl(url.toString(), {
      allowPrivate: env.allowPrivateUrls,
      timeoutMs: env.fetchTimeoutMs,
      accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof FetchRefused) throw new LibraryError(error.message);
    throw error;
  }
  if (response.status !== 200) {
    response.body.resume();
    throw new LibraryError(
      `${response.url.host} answered HTTP ${response.status}${response.status === 403 || response.status === 401 ? ": the page is not public" : ""}.`,
    );
  }
  const type = response.contentType;
  if (type === "text/html" || type === "application/xhtml+xml" || type === "text/plain" || type === "") {
    const bytes = await readLimited(response.body, PAGE_BYTES).catch((error: unknown) => {
      throw error instanceof FetchRefused ? new LibraryError(error.message) : error;
    });
    const text = new TextDecoder(charsetOf(response.body.headers["content-type"])).decode(bytes);
    if (type === "text/plain")
      return {
        kind: "article",
        url: response.url.toString(),
        title: response.url.pathname.split("/").pop() || response.url.host,
        text: text.trim(),
      };
    const article = extractArticle(text, response.url.toString());
    if (!article.text.trim())
      throw new LibraryError(
        "That page has no readable text (it may need JavaScript or a sign-in). Copy the text and paste it instead.",
      );
    return {
      kind: "article",
      url: response.url.toString(),
      title: article.title,
      text: article.text,
      siteName: article.siteName,
    };
  }
  if (!FILE_TYPES.test(type)) {
    response.body.resume();
    throw new LibraryError(`That link is a ${type} file, which the library does not read.`);
  }
  if (response.contentLength !== null && response.contentLength > env.maxUploadBytes) {
    response.body.destroy();
    throw new LibraryError(
      `That file is larger than ${Math.round(env.maxUploadBytes / 1024 / 1024)} MB (TROUPE_LIBRARY_MAX_UPLOAD_MB).`,
    );
  }
  // A file may take longer than a page: as long as yt-dlp's downloads.
  response.keepFor(FILE_DEADLINE_MS);
  const dir = await mkdtemp(join(tmpdir(), "troupe-fetch-"));
  const dispose = () => rm(dir, { recursive: true, force: true });
  const path = join(dir, "download");
  let size = 0;
  try {
    await pipeline(
      response.body,
      new Transform({
        transform(chunk: Buffer, _encoding, done) {
          size += chunk.length;
          if (size > env.maxUploadBytes)
            return done(
              new LibraryError(
                `That file is larger than ${Math.round(env.maxUploadBytes / 1024 / 1024)} MB (TROUPE_LIBRARY_MAX_UPLOAD_MB).`,
              ),
            );
          done(null, chunk);
        },
      }),
      createWriteStream(path, { mode: 0o600 }),
    );
  } catch (error) {
    await dispose();
    throw error;
  }
  const name = decodeURIComponent(response.url.pathname.split("/").pop() || "") || response.url.host;
  return {
    kind: "file",
    url: response.url.toString(),
    title: name.replace(/\.[A-Za-z0-9]{1,5}$/, ""),
    path,
    mimeType: type,
    bytes: size,
    checksum: "",
    durationS: null,
    dispose,
  };
}
