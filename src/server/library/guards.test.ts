import { describe, expect, it } from "vitest";

import { extractArticle } from "./article";
import { checkPublicAddress, checkPublicUrl } from "./public-url";
import { sniffType } from "./sniff";
import { libraryEnvironment } from "./config";
import { isVideoPlatform, videoRefusal, ytDlpArgs, ytDlpInfoArgs } from "./ytdlp";

const bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...Buffer.from(p, "latin1")] : p)));

describe("sniffType", () => {
  it("names a file by its first bytes, whatever its name says", () => {
    expect(sniffType(bytes([0, 0, 0, 0x18], "ftypmp42"))).toBe("video/mp4");
    expect(sniffType(bytes([0, 0, 0, 0x14], "ftypqt  "))).toBe("video/quicktime");
    expect(sniffType(bytes([0, 0, 0, 0x1c], "ftypM4A "))).toBe("audio/mp4");
    expect(sniffType(bytes([0x1a, 0x45, 0xdf, 0xa3]))).toBe("video/webm");
    expect(sniffType(bytes("ID3", [3, 0]))).toBe("audio/mpeg");
    expect(sniffType(bytes([0xff, 0xfb, 0x90]))).toBe("audio/mpeg");
    expect(sniffType(bytes("RIFF", [0, 0, 0, 0], "WAVE"))).toBe("audio/wav");
    expect(sniffType(bytes("RIFF", [0, 0, 0, 0], "WEBP"))).toBe("image/webp");
    expect(sniffType(bytes("OggS"))).toBe("audio/ogg");
    expect(sniffType(bytes("fLaC"))).toBe("audio/flac");
    expect(sniffType(bytes([0x89], "PNG\r\n"))).toBe("image/png");
    expect(sniffType(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffType(bytes("GIF89a"))).toBe("image/gif");
    expect(sniffType(bytes("%PDF-1.7"))).toBe("application/pdf");
    expect(sniffType(bytes("Hello, plain words\nand a second line"))).toBe("text/plain");
    expect(sniffType(new TextEncoder().encode("Café crème, déjà vu"))).toBe("text/plain");
  });

  it("refuses what it does not know, and markup that would run as a page", () => {
    expect(sniffType(bytes("<!doctype html><script>alert(1)</script>"))).toBeNull();
    expect(sniffType(bytes('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffType(bytes([0x4d, 0x5a, 0x90, 0]))).toBeNull();
    expect(sniffType(bytes("text with a \u0000 nul"))).toBeNull();
    expect(sniffType(new Uint8Array())).toBeNull();
  });
});

describe("checkPublicAddress", () => {
  it("allows public addresses only", () => {
    for (const ip of ["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111"]) expect(checkPublicAddress(ip)).toBeNull();
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "255.255.255.255",
      "198.18.0.1",
      "::1",
      "::",
      "fe80::1",
      "fd00:ec2::254",
      "fc00::1",
      "::ffff:127.0.0.1",
      "::ffff:a9fe:a9fe",
      "64:ff9b::a9fe:a9fe",
    ]) {
      expect(checkPublicAddress(ip), ip).not.toBeNull();
    }
  });
});

describe("checkPublicUrl", () => {
  it("takes http(s) links to named or public hosts", () => {
    expect(checkPublicUrl("https://example.com/post?id=1")).toEqual({
      ok: true,
      url: new URL("https://example.com/post?id=1"),
    });
    expect(checkPublicUrl("example.com/post")).toMatchObject({ ok: true });
  });

  it("refuses other schemes, credentials, odd ports and private literals", () => {
    expect(checkPublicUrl("file:///etc/passwd")).toMatchObject({ ok: false });
    expect(checkPublicUrl("ftp://example.com/a")).toMatchObject({ ok: false });
    expect(checkPublicUrl("https://user:pass@example.com/")).toMatchObject({ ok: false });
    expect(checkPublicUrl("http://169.254.169.254/latest/meta-data")).toMatchObject({ ok: false });
    expect(checkPublicUrl("http://[::1]:3000/")).toMatchObject({ ok: false });
    expect(checkPublicUrl("http://metadata.google.internal/")).toMatchObject({ ok: false });
    expect(checkPublicUrl("http://localhost:5432/")).toMatchObject({ ok: false });
    expect(checkPublicUrl("http://db/")).toMatchObject({ ok: false });
    expect(checkPublicUrl("https://example.com:22/")).toMatchObject({ ok: false });
    expect(checkPublicUrl("not a url")).toMatchObject({ ok: false });
  });

  it("lets a self-hoster allow their own network on purpose", () => {
    expect(checkPublicUrl("http://192.168.1.20/clip.mp4", { allowPrivate: true })).toMatchObject({ ok: true });
    expect(checkPublicUrl("http://169.254.169.254/", { allowPrivate: true })).toMatchObject({ ok: false });
  });
});

describe("yt-dlp", () => {
  it("knows the video platforms", () => {
    for (const url of [
      "https://www.youtube.com/shorts/abc",
      "https://youtu.be/abc",
      "https://www.tiktok.com/@a/video/1",
      "https://vimeo.com/1",
      "https://www.instagram.com/reel/x/",
      "https://x.com/a/status/1",
    ])
      expect(isVideoPlatform(new URL(url)), url).toBe(true);
    expect(isVideoPlatform(new URL("https://example.com/blog/post"))).toBe(false);
    expect(isVideoPlatform(new URL("https://notyoutube.com/x"))).toBe(false);
  });

  it("passes the link as an argument after --, with limits and no config or plugins", () => {
    const args = ytDlpArgs("https://youtu.be/abc", {
      dir: "/tmp/x",
      maxBytes: 500 * 1024 * 1024,
      maxDurationS: 3600,
      ffmpegLocation: "/usr/bin/ffmpeg",
    });
    expect(args.slice(-2)).toEqual(["--", "https://youtu.be/abc"]);
    expect(args).toEqual(
      expect.arrayContaining([
        "--ignore-config",
        "--no-plugin-dirs",
        "--no-playlist",
        "--no-exec",
        "--max-filesize",
        "500M",
        "--match-filter",
        "duration <= 3600",
        "--restrict-filenames",
      ]),
    );
    expect(args[args.indexOf("-o") + 1]).toBe("/tmp/x/media.%(ext)s");
    expect(args[args.indexOf("--ffmpeg-location") + 1]).toBe("/usr/bin/ffmpeg");
    expect(args).not.toContain("--proxy");
  });

  it("uses the platforms' own extractors only: the generic one would fetch any page a link or a redirect points at", () => {
    const args = ytDlpArgs("https://youtu.be/abc", { dir: "/tmp/x", maxBytes: 1024 * 1024, maxDurationS: 60 });
    const at = args.indexOf("--use-extractors");
    expect(args[at + 1]).toBe("default,-generic");
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(args.indexOf("--"));
  });

  it("goes through the proxy a self-hoster names", () => {
    const args = ytDlpArgs("https://youtu.be/abc", {
      dir: "/tmp/x",
      maxBytes: 1024 * 1024,
      maxDurationS: 60,
      proxy: "http://egress:3128",
    });
    expect(args[args.indexOf("--proxy") + 1]).toBe("http://egress:3128");
    expect(args.indexOf("--proxy")).toBeLessThan(args.indexOf("--"));
  });

  it("says why a video cannot be saved, from its details, before downloading it", () => {
    expect(videoRefusal({ live_status: "is_live", duration: null }, 3600)).toMatch(/live/);
    expect(videoRefusal({ live_status: "is_upcoming" }, 3600)).toMatch(/not started|live/);
    expect(videoRefusal({ is_live: true }, 3600)).toMatch(/live/);
    expect(videoRefusal({}, 3600)).toMatch(/length is not known/);
    expect(videoRefusal({ duration: 5400 }, 3600)).toMatch(/1:30:00 long.*1:00:00/);
    expect(videoRefusal({ duration: 30, live_status: "was_live" }, 3600)).toBeNull();
    expect(videoRefusal({ duration: 3600 }, 3600)).toBeNull();
  });

  it("asks for the details with the same guards, without downloading", () => {
    const args = ytDlpInfoArgs("https://youtu.be/abc", { proxy: null });
    expect(args).toEqual(
      expect.arrayContaining([
        "--ignore-config",
        "--no-plugin-dirs",
        "--no-playlist",
        "--dump-single-json",
        "--skip-download",
      ]),
    );
    expect(args[args.indexOf("--use-extractors") + 1]).toBe("default,-generic");
    expect(args.slice(-2)).toEqual(["--", "https://youtu.be/abc"]);
  });
});

describe("libraryEnvironment", () => {
  it("bounds each writing request and the ideas a set holds", () => {
    expect(libraryEnvironment({})).toMatchObject({ writeTimeoutMs: 300_000, ideas: 10 });
    expect(libraryEnvironment({ TROUPE_LIBRARY_WRITE_TIMEOUT_S: "240", TROUPE_LIBRARY_IDEAS: "3" })).toMatchObject({
      writeTimeoutMs: 240_000,
      ideas: 3,
    });
    // Out of range: the default (env.js refuses it at startup).
    expect(libraryEnvironment({ TROUPE_LIBRARY_WRITE_TIMEOUT_S: "5", TROUPE_LIBRARY_IDEAS: "40" })).toMatchObject({
      writeTimeoutMs: 300_000,
      ideas: 10,
    });
  });

  it("turns video links off, and names a proxy for yt-dlp", () => {
    expect(libraryEnvironment({ TROUPE_YTDLP_PATH: "off" }).ytDlpPath).toBeNull();
    expect(libraryEnvironment({}).ytDlpPath).toBe("yt-dlp");
    expect(libraryEnvironment({ TROUPE_YTDLP_PATH: "" }).ytDlpPath).toBe("yt-dlp");
    expect(libraryEnvironment({ TROUPE_YTDLP_PATH: "/opt/yt-dlp" }).ytDlpPath).toBe("/opt/yt-dlp");
    expect(libraryEnvironment({ TROUPE_YTDLP_PROXY: "socks5://127.0.0.1:1080" }).ytDlpProxy).toBe(
      "socks5://127.0.0.1:1080",
    );
    expect(libraryEnvironment({}).ytDlpProxy).toBeNull();
  });
});

describe("extractArticle", () => {
  it("keeps the article's title and words, without the page around it", () => {
    const html = `<!doctype html><html><head><title>Three hooks that work | Blog</title><meta property="og:site_name" content="Blog"></head>
      <body><nav>Home About Contact</nav><script>track()</script>
      <article><h1>Three hooks that work</h1><p>${"The first hook is a bold claim that the viewer wants to check. ".repeat(6)}</p><p>${"The second hook asks a question the viewer cannot answer yet. ".repeat(6)}</p></article>
      <footer>© Blog</footer></body></html>`;
    const article = extractArticle(html, "https://example.com/hooks");
    expect(article.title).toBe("Three hooks that work");
    expect(article.text).toContain("The first hook is a bold claim");
    expect(article.text).toContain("The second hook asks a question");
    expect(article.text).not.toContain("track()");
    expect(article.text).not.toContain("Home About Contact");
    expect(article.siteName).toBe("Blog");
  });

  it("falls back to the page's text when it has no article", () => {
    const article = extractArticle(
      "<html><head><title>Note</title></head><body><p>Short note.</p></body></html>",
      "https://example.com/n",
    );
    expect(article).toMatchObject({ title: "Note", text: "Short note." });
  });
});
