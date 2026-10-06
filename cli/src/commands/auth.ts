import { createApi, exchangeAccessCode, explainError, studioHealth } from "../client.ts";
import { type Command, type Context, flag } from "../command.ts";
import { configPath, isLoopback, updateConfig } from "../config.ts";
import { CliError, EXIT } from "../errors.ts";
import { ago, fields, table } from "../output.ts";
import { CLAUDE_CHAT_ANSWER_USD } from "../../../src/modules/models/list-price.ts";
import { livePlans, money, planTotal, runLive } from "./live.ts";
import { validateWatch, WATCH_OPTIONS } from "./render.ts";

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

// --code-stdin first (asked without echo when stdin is a terminal), then
// TROUPE_ACCESS_CODE, then a hidden prompt.
async function readCode(ctx: Context, fromStdin: boolean): Promise<string> {
  const { io } = ctx;
  const ask = () => io.promptSecret(`Access code for ${ctx.url}: `);
  let code: string | undefined;
  if (fromStdin) code = (await (io.stdinIsTTY ? ask() : io.readStdin())).trim();
  else code = io.env.TROUPE_ACCESS_CODE || (io.stdinIsTTY ? (await ask()).trim() : undefined);
  if (!code) {
    throw new CliError(
      "This studio needs its access code. Pipe it in with --code-stdin, set TROUPE_ACCESS_CODE, or run troupe login in a terminal.",
      { exitCode: EXIT.auth, code: "UNAUTHORIZED" },
    );
  }
  return code;
}

const login: Command = {
  path: ["login"],
  summary: "Sign in to a studio with its access code and remember it as a profile.",
  options: {
    "code-stdin": {
      type: "boolean",
      description: "Read the access code from stdin (asked without echo on a terminal); wins over TROUPE_ACCESS_CODE.",
    },
  },
  examples: [
    "troupe login --url http://127.0.0.1:3000",
    "troupe login --url https://studio.example.com --profile home",
    'printf %s "$TROUPE_CODE" | troupe login --url http://localhost:3100 --code-stdin',
    "troupe login --url http://192.168.1.20:3100 --insecure   # a studio on your LAN, without TLS",
  ],
  async run(ctx, { options }) {
    const health = await studioHealth(ctx.url);
    if (!health.ok)
      throw new CliError(
        `${ctx.url}/api/health answered HTTP ${health.status}: the studio or its database is not ready.`,
        { code: "UNHEALTHY" },
      );

    let cookie: string | null = null;
    if (!(await admitted(ctx.url, null))) {
      cookie = await exchangeAccessCode(ctx.url, await readCode(ctx, flag(options, "code-stdin")));
      if (cookie === null) {
        throw new CliError(
          "This studio has no access code and only lets in requests from its own machine. Set TROUPE_ACCESS_CODE on the server to reach it from here.",
          { exitCode: EXIT.auth, code: "FORBIDDEN" },
        );
      }
      if (!(await admitted(ctx.url, cookie)))
        throw new CliError("The studio accepted the code but still refuses requests. Try troupe login again.", {
          exitCode: EXIT.auth,
          code: "UNAUTHORIZED",
        });
    }

    await updateConfig(ctx.io.env, (config) => {
      const previous = config.profiles[ctx.profileName];
      config.profiles[ctx.profileName] = {
        url: ctx.url,
        ...(cookie ? { cookie } : {}),
        // A project id only means something on the studio it came from.
        ...(previous?.project && previous.url === ctx.url ? { project: previous.project } : {}),
        // Plain http to another machine passed the check, so --insecure was given.
        ...(ctx.url.startsWith("http:") && !isLoopback(ctx.url) ? { insecure: true } : {}),
      };
      config.profile = ctx.profileName;
    });
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
    await ctx.updateProfile((profile) => {
      if (!profile) return undefined;
      const { cookie: _cookie, ...rest } = profile;
      return rest;
    });
    const envNote = ctx.io.env.TROUPE_ACCESS_CODE
      ? " TROUPE_ACCESS_CODE is still set in this shell and signs every command in."
      : "";
    return {
      data: { profile: ctx.profileName, url: ctx.url, signedOut: true },
      text: `Signed out of ${ctx.url} (profile "${ctx.profileName}").${envNote}`,
    };
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
    const credential = ctx.io.env.TROUPE_ACCESS_CODE
      ? "TROUPE_ACCESS_CODE"
      : profile?.cookie && profile.url === ctx.url
        ? "saved cookie"
        : "none";
    let project: { id: string; title: string } | null = null;
    if (signedIn) {
      try {
        const found = await ctx.project();
        project = { id: found.id, title: found.title };
      } catch {
        project = null;
      }
    }
    const data = {
      profile: ctx.profileName,
      url: ctx.url,
      reachable: signedIn !== null,
      signedIn: signedIn === true,
      credential,
      project,
      configFile: configPath(ctx.io.env),
    };
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

type Status = "ok" | "warn" | "fail" | "skip";
interface Check {
  name: string;
  status: Status;
  detail: string;
}

const WORKER_STALE_MS = 2 * 60_000;

const ACCOUNTS = [
  { id: "google", name: "Google AI" },
  { id: "fal", name: "fal.ai" },
  { id: "anthropic", name: "Anthropic" },
] as const;

const doctor: Command = {
  path: ["doctor"],
  summary:
    "Check the studio, the sign-in, the video models (local ones are contacted), the job worker, the script chat and the library's tools (transcription, vision, search, yt-dlp); --providers checks each API key for free, --live renders for real.",
  options: {
    "skip-tests": {
      type: "boolean",
      description: "Do not contact local models or the chat provider; only read their status.",
    },
    providers: {
      type: "boolean",
      description:
        "Check each provider account's key with a free call (Google: the model's metadata; fal.ai: the endpoint's price; Anthropic: the model).",
    },
    live: {
      type: "boolean",
      description:
        "Render one clip per model at its cheapest settings and ffprobe the download; prints the plan and its cost first.",
    },
    yes: { type: "boolean", description: "With --live: spend the estimate shown and launch." },
    model: {
      type: "string",
      multiple: true,
      value: "<model>",
      description: "With --live: only these models; repeat it for each (default: every model that can launch).",
    },
    output: {
      type: "string",
      short: "o",
      value: "<folder>",
      description: "With --live: where the videos land (default: ./troupe-live-<date>).",
    },
    ...WATCH_OPTIONS,
  },
  examples: [
    "troupe doctor",
    "troupe doctor --providers",
    "troupe doctor --live",
    "troupe doctor --live --model seedance-1.5-pro --yes",
  ],
  validate: validateWatch,
  async run(ctx, { options }) {
    const checks: Check[] = [];
    const add = (name: string, status: Status, detail: string) => checks.push({ name, status, detail });
    const contact = !flag(options, "skip-tests");
    const live = flag(options, "live");
    const providers = flag(options, "providers") || live;
    let extra: {
      data: Record<string, unknown>;
      text: string;
      failed: boolean;
      exitCode?: (typeof EXIT)[keyof typeof EXIT];
    } | null = null;
    const finish = () => {
      const failed = checks.some((c) => c.status === "fail") || Boolean(extra?.failed);
      const text = table(
        ["STATUS", "CHECK", "DETAIL"],
        checks.map((c) => [c.status, c.name, c.detail]),
      );
      return {
        data: { ok: !failed, url: ctx.url, checks, ...extra?.data },
        text: extra ? `${text}\n\n${extra.text}` : text,
        exitCode: extra?.exitCode ?? (failed ? EXIT.failed : EXIT.ok),
      };
    };

    try {
      const health = await studioHealth(ctx.url);
      if (!health.ok) {
        add(
          "studio",
          "fail",
          `${ctx.url}/api/health answered HTTP ${health.status}: the server or its database is down.`,
        );
        return finish();
      }
      add("studio", "ok", `${ctx.url} answers and its database is up.`);
    } catch (error) {
      add("studio", "fail", explainError(error, ctx.url).message);
      return finish();
    }

    try {
      await ctx.api.identity.myWorkspaces.query();
      add(
        "sign-in",
        "ok",
        ctx.io.env.TROUPE_ACCESS_CODE
          ? "Signed in with TROUPE_ACCESS_CODE."
          : `Signed in (profile "${ctx.profileName}").`,
      );
    } catch (error) {
      add("sign-in", "fail", explainError(error, ctx.url).message);
      return finish();
    }

    const { models, defaultModelKey } = await ctx.api.settings.models.list.query();
    const launchable = models.filter((m) => m.status === "ready" && m.enabled && !m.archived);
    if (launchable.length === 0) {
      add(
        "models",
        "fail",
        'No video model can launch. Add one: troupe models add http --name "Local renderer" --base-url http://127.0.0.1:8078 (with pnpm renderer running).',
      );
    } else {
      const fallback = defaultModelKey ? models.find((m) => m.key === defaultModelKey) : undefined;
      add(
        "models",
        fallback ? "ok" : "warn",
        `${launchable.length} ready to launch (${launchable.map((m) => m.key).join(", ")}); default: ${fallback ? fallback.key : "none, pass --model when launching"}.`,
      );
    }
    for (const model of launchable) {
      if (model.kind !== "local") {
        if (!providers) {
          add(
            `model ${model.key}`,
            "ok",
            `${model.label}: key configured; not contacted (troupe doctor --providers checks it for free).`,
          );
          continue;
        }
        const report = await ctx.api.settings.models.test.mutate({ modelKey: model.key });
        add(
          `model ${model.key}`,
          report.ok === true ? "ok" : report.ok === null ? "warn" : "fail",
          `${model.label}: ${report.message}`,
        );
        continue;
      }
      if (!contact) {
        add(`model ${model.key}`, "ok", `${model.label}: ready (not contacted).`);
        continue;
      }
      const report = await ctx.api.settings.models.test.mutate({ modelKey: model.key });
      const status: Status =
        report.ok === true ? "ok" : report.ok === null ? "warn" : model.key === defaultModelKey ? "fail" : "warn";
      add(`model ${model.key}`, status, `${model.label}: ${report.message}`);
    }

    if (providers) {
      const status = await ctx.api.settings.credentials.status.query();
      for (const account of ACCOUNTS) {
        const s = status[account.id];
        if (!s.configured) {
          add(
            `account ${account.id}`,
            "skip",
            `${account.name}: ${s.source === "disabled" ? "turned off" : s.source === "undecryptable" ? "the saved key can no longer be read; enter it again in Settings" : "no key (optional)"}.`,
          );
          continue;
        }
        const report = await ctx.api.settings.credentials.test.mutate({ provider: account.id });
        add(
          `account ${account.id}`,
          report.ok === true ? "ok" : report.ok === null ? "warn" : "fail",
          `${account.name} (${s.source === "saved" ? "saved key" : "environment key"}): ${report.message}`,
        );
      }
    }

    const beat = await ctx.api.ops.reconcileHeartbeat.query();
    if (beat && Date.now() - new Date(beat.ranAt).getTime() < WORKER_STALE_MS) {
      add("worker", "ok", `The background worker checked renders ${ago(beat.ranAt)}.`);
    } else {
      add(
        "worker",
        "warn",
        `No background worker run in the last 2 minutes (last: ${ago(beat?.ranAt)}). Renders still progress while troupe render watch or the project page follows them; set TROUPE_INPROCESS_WORKER=1 on the server for unattended renders.`,
      );
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

    // The inspiration library's tools: optional, so a missing one warns.
    try {
      const library = await ctx.api.library.status.query();
      for (const tool of library.tools)
        add(
          `library ${tool.name}`,
          tool.ready ? "ok" : "warn",
          `${tool.label}${tool.model ? ` (${tool.model})` : ""}: ${tool.detail}`,
        );
    } catch (error) {
      add("library", "warn", explainError(error, ctx.url).message);
    }

    if (live) {
      if (checks.some((c) => c.status === "fail")) {
        extra = {
          data: { live: null },
          text: "Nothing was launched: fix the failed checks above first.",
          failed: true,
        };
        return finish();
      }
      const plans = await livePlans(ctx, options);
      const total = planTotal(plans);
      const plan = table(
        ["MODEL", "CLIP", "COST"],
        plans.map((p) => [
          p.label,
          `${p.durationS} s, ${p.resolution}, ${p.audio ? "with audio" : "silent"}`,
          money(p.estimateUsd),
        ]),
      );
      const unknown = total.unknown.length ? `, plus ${total.unknown.join(", ")} (no price set)` : "";
      const spend = `${total.usd > 0 ? `${money(total.usd)}, billed by each provider` : "nothing on video models"}${unknown}, and one script chat answer (Claude: about $${CLAUDE_CHAT_ANSWER_USD.lowUsd.toFixed(2)}–${CLAUDE_CHAT_ANSWER_USD.highUsd.toFixed(2)}; Ollama: free)`;
      if (!flag(options, "yes")) {
        extra = {
          data: { live: { plans, confirmed: false } },
          text: `${plan}\n\nNothing was launched. This would spend ${spend}. Run again with --yes to launch.`,
          failed: false,
          exitCode: EXIT.usage,
        };
        return finish();
      }
      ctx.note(`Launching ${plans.length} render${plans.length === 1 ? "" : "s"}; this spends ${spend}.`);
      const outcome = await runLive(ctx, plans, options);
      const failed = outcome.results.some((r) => r.status !== "completed") || !outcome.chat.ok;
      extra = {
        data: { live: { ...outcome, confirmed: true } },
        text: [
          table(
            ["RESULT", "MODEL", "CLIP", "COST", "VIDEO"],
            outcome.results.map((r) => [
              r.status === "completed" ? "ok" : "fail",
              r.label,
              `${r.durationS} s, ${r.resolution}`,
              money(r.estimateUsd),
              r.detail,
            ]),
          ),
          `${outcome.chat.ok ? "ok" : "fail"}  chat: ${outcome.chat.detail}`,
          `Videos in ${outcome.folder}; renders in project ${outcome.projectId}.`,
        ].join("\n"),
        failed,
      };
    }
    return finish();
  },
};

export const authCommands: Command[] = [login, logout, whoami, doctor];
