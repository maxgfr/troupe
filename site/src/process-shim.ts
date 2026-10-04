// Server modules read process.env (provider keys, VERCEL…). The browser has
// no environment: every read finds nothing, as on a server with none set,
// except NODE_ENV, which tRPC reads to decide whether to log timings.
const scope = globalThis as { process?: { env: Record<string, string | undefined> } };
scope.process ??= { env: { NODE_ENV: import.meta.env.MODE } };
