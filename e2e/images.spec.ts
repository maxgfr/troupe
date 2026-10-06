import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";

import { TAG } from "./stack";

// What the images and the Compose file do on their own, outside the running
// stack: the licenses the images must carry, and the database's
// first-start password, run from the exact script docker-compose.yml holds.

const REPO = new URL("..", import.meta.url);
const docker = (...args: string[]) =>
  execFileSync("docker", args, { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 5 * 60_000 });

test("the Ollama image carries Ollama's license and the notices for what it bundles", () => {
  const read = (file: string) => docker("run", "--rm", "--entrypoint", "cat", `troupe-e2e/ollama:${TAG}`, file);
  const license = read("/usr/share/doc/ollama/LICENSE");
  expect(license).toMatch(/^MIT License/);
  expect(license).toContain("Copyright (c) Ollama");
  const notice = read("/usr/share/doc/ollama/NOTICE");
  for (const name of ["libgomp.so.1", "libomp.so", "GCC Runtime Library Exception", "LLVM Exceptions"])
    expect(notice).toContain(name);
  // Every file the notice points at is in the image.
  const files = [...new Set(notice.match(/\/usr\/[\w/.-]+[\w]/g) ?? [])].filter(
    (f) => !f.endsWith(".so") && !f.endsWith(".so.1"),
  );
  expect(files.length).toBeGreaterThan(5);
  const missing = docker(
    "run",
    "--rm",
    "--entrypoint",
    "sh",
    `troupe-e2e/ollama:${TAG}`,
    "-c",
    `for f in ${files.join(" ")}; do test -e "$f" || echo "$f"; done`,
  );
  expect(missing.trim()).toBe("");
});

test("every Troupe image carries its license, the third-party notices and the GPL's text, and says which license applies", () => {
  for (const [service, license] of [
    ["app", "MIT"],
    ["renderer", "GPL-3.0-or-later"],
    ["web", "GPL-3.0-or-later"],
    ["cli", "MIT"],
  ] as const) {
    const image = `troupe-e2e/${service}:${TAG}`;
    const read = (file: string) => docker("run", "--rm", "--entrypoint", "cat", image, `/usr/share/doc/troupe/${file}`);
    expect(read("LICENSE"), service).toMatch(/^MIT License/);
    expect(read("THIRD_PARTY_NOTICES.md"), service).toMatch(/^# Third-party notices/);
    expect(read("GPL-3.0.txt"), service).toContain("GNU GENERAL PUBLIC LICENSE");
    expect(
      docker("image", "inspect", "--format", '{{ index .Config.Labels "org.opencontainers.image.licenses" }}', image).trim(),
      service,
    ).toBe(license);
  }
});

test("the app image runs yt-dlp, and the renderer image carries faster-whisper", () => {
  expect(docker("run", "--rm", "--entrypoint", "yt-dlp", `troupe-e2e/app:${TAG}`, "--version").trim()).toMatch(
    /^\d{4}\.\d{2}\.\d{2}/,
  );
  expect(
    docker(
      "run",
      "--rm",
      "--entrypoint",
      "/app/renderer/whisper/.venv/bin/python",
      `troupe-e2e/renderer:${TAG}`,
      "-c",
      "import faster_whisper; print(faster_whisper.__version__)",
    ).trim(),
  ).toBe("1.2.1");
});

test.describe("the database's generated password", () => {
  // The db service as docker-compose.yml defines it, run with plain docker.
  const config = JSON.parse(
    docker("compose", "-f", "docker-compose.yml", "--env-file", "e2e/stack.env", "config", "--format", "json"),
  );
  const db = config.services.db as { image: string; entrypoint: string[]; command: string[] };
  const script = db.entrypoint[2]!.replaceAll("$$", "$");
  const id = randomBytes(4).toString("hex");
  const data = `troupe-e2e-dbtest-data-${id}`;
  const secrets = `troupe-e2e-dbtest-secrets-${id}`;
  const name = `troupe-e2e-dbtest-${id}`;

  const run = (password: string, detach: boolean) =>
    spawnSync(
      "docker",
      [
        "run",
        ...(detach ? ["-d", "--name", name] : ["--rm", "--name", `${name}-refused`]),
        "-v",
        `${data}:/var/lib/postgresql/data`,
        "-v",
        `${secrets}:/run/troupe-secrets`,
        "-e",
        "POSTGRES_DB=troupe",
        "-e",
        `POSTGRES_PASSWORD=${password}`,
        "--entrypoint",
        db.entrypoint[0]!,
        db.image,
        db.entrypoint[1]!,
        script,
        db.entrypoint[3]!,
        ...db.command,
      ],
      { encoding: "utf8", timeout: 120_000 },
    );

  // Signs in over TCP, where the image asks for the password.
  const signIn = async (password: string) => {
    await expect
      .poll(
        () =>
          spawnSync(
            "docker",
            [
              "exec",
              "-e",
              `PGPASSWORD=${password}`,
              name,
              "psql",
              "-h",
              "127.0.0.1",
              "-U",
              "postgres",
              "-d",
              "troupe",
              "-tAc",
              "select 1",
            ],
            { encoding: "utf8" },
          ).stdout.trim(),
        { timeout: 60_000 },
      )
      .toBe("1");
  };
  const stop = () => spawnSync("docker", ["rm", "-f", name, `${name}-refused`], { encoding: "utf8" });

  test.afterAll(() => {
    stop();
    spawnSync("docker", ["volume", "rm", "-f", data, secrets]);
  });

  test("is made with a new database, refused for an old one without it, and a set one still opens it", async () => {
    // A new database: a password is generated, kept, and opens it.
    expect(run("", true).status).toBe(0);
    await expect
      .poll(
        () =>
          spawnSync("docker", ["exec", name, "cat", "/run/troupe-secrets/postgres-password"], { encoding: "utf8" })
            .stdout,
        { timeout: 60_000 },
      )
      .toMatch(/^[0-9a-f]{48}$/);
    const generated = docker("exec", name, "cat", "/run/troupe-secrets/postgres-password");
    await signIn(generated);
    stop();

    // The generated password lost (or a database from an older stack) and
    // none in .env: the service says what to do instead of making a new one.
    docker("run", "--rm", "-v", `${secrets}:/s`, "--entrypoint", "rm", db.image, "/s/postgres-password");
    const refused = run("", false);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("docs/SELF-HOSTING.md#upgrade");
    expect(docker("run", "--rm", "-v", `${secrets}:/s`, "--entrypoint", "ls", db.image, "-A", "/s").trim()).toBe("");

    // POSTGRES_PASSWORD put back: the database opens as before.
    expect(run(generated, true).status).toBe(0);
    await signIn(generated);
  });
});
