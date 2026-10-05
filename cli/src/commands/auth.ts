import { createApi, exchangeAccessCode, explainError, studioHealth } from "../client.ts";
import { type Command, type Context, flag } from "../command.ts";
import { configPath, readConfig, writeConfig } from "../config.ts";
import { CliError, EXIT } from "../errors.ts";
import { ago, fields, table } from "../output.ts";

// Does this studio answer API calls with the given cookie (or none)?
async function admitted(url: string, cookie: string | null): Promise<boolean> {
  try {
    await createApi({ url, cookie: async () => cookie }).identity.myWorkspaces.query();
    return true;
  } catch (error) {
    const explained = explainError(error, url);
    if (explained.exitCode === EXIT.auth) return false;
    throw explained;
  }
}

async function readCode(ctx: Context, fromStdin: boolean): Promise<string> {
  const { io } = ctx;
  let code = io.env.TROUPE_ACCESS_CODE;
  if (!code && fromStdin) code = (await io.readStdin()).trim();
  if (!code && io.stdinIsTTY && !fromStdin) code = (await io.promptSecret(`Access code for ${ctx.url}: `)).trim();
  if (!code) {
    throw new CliError("This studio needs its access code. Pipe it in with --code-stdin, set TROUPE_ACCESS_CODE, or run troupe login in a terminal.", { exitCode: EXIT.auth, code: "UNAUTHORIZED" });
  }
  return code;
}

const login: Command = {
  path: ["login"],
  summary: "Sign in to a studio with its access code and remember it as a profile.",
  options: {
    "code-stdin": { type: "boolean", description: "Read the access code from stdin instead of TROUPE_ACCESS_CODE or a hidden prompt." },
  },
  examples: [
    "troupe login --url http://127.0.0.1:3000",
    "troupe login --url https://studio.example.com --profile home",
    "printf %s \"$TROUPE_CODE\" | troupe login --url http://localhost:3100 --code-stdin",
  ],
  async run(ctx, { options }) {
    const health = await studioHealth(ctx.url);
    if (!health.ok) throw new CliError(`${ctx.url}/api/health answered HTTP ${health.status}: the studio or its database is not ready.`, { code: "UNHEALTHY" });

    let cookie: string | null = null;
    if (!(await admitted(ctx.url, null))) {
      cookie = await exchangeAccessCode(ctx.url, await readCode(ctx, flag(options, "code-stdin")));
      if (cookie === null) {
        throw new CliError("This studio has no access code and only lets in requests from its own machine. Set TROUPE_ACCESS_CODE on the server to reach it from here.", { exitCode: EXIT.auth, code: "FORBIDDEN" });
      }
      if (!(await admitted(ctx.url, cookie))) throw new CliError("The studio accepted the code but still refuses requests. Try troupe login again.", { exitCode: EXIT.auth, code: "UNAUTHORIZED" });
    }

    const config = await readConfig(ctx.io.env);
    const previous = config.profiles[ctx.profileName];
    config.profiles[ctx.profileName] = {
      url: ctx.url,
      ...(cookie ? { cookie } : {}),
      // A project id only means something on the studio it came from.
      ...(previous?.project && previous.url === ctx.url ? { project: previous.project } : {}),
    };
    config.profile = ctx.profileName;
    await writeConfig(ctx.io.env, config);
    const access = cookie ? "code" : "open";
    return {
      data: { profile: ctx.profileName, url: ctx.url, access },
      text: cookie
        ? `Signed in to ${ctx.url} (profile "${ctx.profileName}").`
        : `Signed in to ${ctx.url} (profile "${ctx.profileName}"). This studio runs without an access code (pnpm dev), so none was needed.`,
    };
  },
};

const logout: Command = {
  path: ["logout"],
  summary: "Forget this profile's access cookie (the address and project stay).",
  async run(ctx) {
    await ctx.updateProfile((profile) => (profile ? { url: profile.url, ...(profile.project ? { project: profile.project } : {}) } : undefined));
    const envNote = ctx.io.env.TROUPE_ACCESS_CODE ? " TROUPE_ACCESS_CODE is still set in this shell and signs every command in." : "";
    return { data: { profile: ctx.profileName, url: ctx.url, signedOut: true }, text: `Signed out of ${ctx.url} (profile "${ctx.profileName}").${envNote}` };
  },
};

const whoami: Command = {
  path: ["whoami"],
  summary: "Show the studio, profile and project commands use, and whether you are signed in.",
  async run(ctx) {
    const config = await ctx.readConfig();
    const profile = config.profiles[ctx.profileName];
    let signedIn: boolean | null;
    try {
      signedIn = await admitted(ctx.url, await ctx.connection.cookie());
    } catch (error) {
      if (explainError(error, ctx.url).exitCode !== EXIT.unreachable) throw error;
      signedIn = null;
    }
    const credential = ctx.io.env.TROUPE_ACCESS_CODE ? "TROUPE_ACCESS_CODE" : profile?.cookie && profile.url === ctx.url ? "saved cookie" : "none";
    let project: { id: string; title: string } | null = null;
    if (signedIn) {
      try {
        const found = await ctx.project();
        project = { id: found.id, title: found.title };
      } catch {
        project = null;
      }
    }
    const data = { profile: ctx.profileName, url: ctx.url, reachable: signedIn !== null, signedIn: signedIn === true, credential, project, configFile: configPath(ctx.io.env) };
    return {
      data,
      text: fields([
        ["Profile", ctx.profileName],
        ["Studio", ctx.url],
        ["Signed in", signedIn === null ? "unknown (studio unreachable)" : signedIn ? "yes" : "no (run troupe login)"],
        ["Credential", credential],
        ["Project", project ? `${project.title} (${project.id})` : "none chosen"],
        ["Config", configPath(ctx.io.env)],
      ]),
      exitCode: signedIn === null ? EXIT.unreachable : signedIn ? EXIT.ok : EXIT.auth,
    };
  },
};

type Status = "ok" | "warn" | "fail";
interface Check {
  name: string;
  status: Status;
  detail: string;
}

const WORKER_STALE_MS = 2 * 60_000;

const doctor: Command = {
  path: ["doctor"],
  summary: "Check the studio, the sign-in, the video models (local ones are contacted), the job worker and the script chat.",
  options: {
    "skip-tests": { type: "boolean", description: "Do not contact local models or the chat provider; only read their status." },
  },
  async run(ctx, { options }) {
    const checks: Check[] = [];
    const add = (name: string, status: Status, detail: string) => checks.push({ name, status, detail });
    const contact = !flag(options, "skip-tests");
    const finish = () => {
      const failed = checks.some((c) => c.status === "fail");
      return {
        data: { ok: !failed, url: ctx.url, checks },
        text: table(["STATUS", "CHECK", "DETAIL"], checks.map((c) => [c.status, c.name, c.detail])),
        exitCode: failed ? EXIT.failed : EXIT.ok,
      };
    };

    try {
      const health = await studioHealth(ctx.url);
      if (!health.ok) {
        add("studio", "fail", `${ctx.url}/api/health answered HTTP ${health.status}: the server or its database is down.`);
        return finish();
      }
      add("studio", "ok", `${ctx.url} answers and its database is up.`);
    } catch (error) {
      add("studio", "fail", explainError(error, ctx.url).message);
      return finish();
    }

    try {
      await ctx.api.identity.myWorkspaces.query();
      add("sign-in", "ok", ctx.io.env.TROUPE_ACCESS_CODE ? "Signed in with TROUPE_ACCESS_CODE." : `Signed in (profile "${ctx.profileName}").`);
    } catch (error) {
      add("sign-in", "fail", explainError(error, ctx.url).message);
      return finish();
    }

    const { models, defaultModelKey } = await ctx.api.settings.models.list.query();
    const launchable = models.filter((m) => m.status === "ready" && m.enabled && !m.archived);
    if (launchable.length === 0) {
      add("models", "fail", "No video model can launch. Add one: troupe models add http --name \"Local renderer\" --base-url http://127.0.0.1:8078 (with pnpm renderer running).");
    } else {
      const fallback = defaultModelKey ? models.find((m) => m.key === defaultModelKey) : undefined;
      add("models", fallback ? "ok" : "warn", `${launchable.length} ready to launch (${launchable.map((m) => m.key).join(", ")}); default: ${fallback ? fallback.key : "none, pass --model when launching"}.`);
    }
    for (const model of launchable) {
      if (model.kind !== "local") {
        add(`model ${model.key}`, "ok", `${model.label}: key configured; not contacted (troupe models test ${model.key} checks it).`);
        continue;
      }
      if (!contact) {
        add(`model ${model.key}`, "ok", `${model.label}: ready (not contacted).`);
        continue;
      }
      const report = await ctx.api.settings.models.test.mutate({ modelKey: model.key });
      const status: Status = report.ok === true ? "ok" : report.ok === null ? "warn" : model.key === defaultModelKey ? "fail" : "warn";
      add(`model ${model.key}`, status, `${model.label}: ${report.message}`);
    }

    const beat = await ctx.api.ops.reconcileHeartbeat.query();
    if (beat && Date.now() - new Date(beat.ranAt).getTime() < WORKER_STALE_MS) {
      add("worker", "ok", `The background worker checked renders ${ago(beat.ranAt)}.`);
    } else {
      add("worker", "warn", `No background worker run in the last 2 minutes (last: ${ago(beat?.ranAt)}). Renders still progress while troupe render watch or the project page follows them; set TROUPE_INPROCESS_WORKER=1 on the server for unattended renders.`);
    }

    try {
      const chat = await ctx.api.settings.chat.get.query();
      const active = chat.active;
      const where = `${active.label} (${active.modelId}), ${chat.saved.wordsPerSecond ?? chat.defaults.wordsPerSecond} words per second`;
      if (active.problem) add("chat", "warn", `${where}: ${active.problem}`);
      else if (!contact) add("chat", "ok", `${where} (not contacted).`);
      else {
        const report = await ctx.api.settings.chat.test.mutate({ provider: active.provider });
        add("chat", report.ok ? "ok" : "warn", `${where}: ${report.message}`);
      }
    } catch (error) {
      add("chat", "warn", explainError(error, ctx.url).message);
    }
    return finish();
  },
};

export const authCommands: Command[] = [login, logout, whoami, doctor];
