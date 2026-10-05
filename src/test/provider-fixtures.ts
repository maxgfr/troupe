// Cloud provider responses, recorded on 2026-10-05: the error bodies from the
// live APIs (an invalid key costs nothing), the success bodies from each
// provider's API reference of that day. The contract tests replay them, so a
// drift shows up as a fixture to re-record rather than a guess.

// Gemini API (https://ai.google.dev/gemini-api/docs/veo).
export const google = {
  operationStarted: { name: "models/veo-3.1-fast-generate-preview/operations/8f3k2n1x" },
  operationRunning: { name: "models/veo-3.1-fast-generate-preview/operations/8f3k2n1x", done: false },
  operationDone: {
    name: "models/veo-3.1-fast-generate-preview/operations/8f3k2n1x",
    done: true,
    response: {
      "@type": "type.googleapis.com/google.ai.generativelanguage.v1beta.PredictLongRunningResponse",
      generateVideoResponse: { generatedSamples: [{ video: { uri: "https://generativelanguage.googleapis.com/v1beta/files/5vx0r9k2:download?alt=media" } }] },
    },
  },
  operationFiltered: { name: "models/veo-3.1-fast-generate-preview/operations/8f3k2n1x", done: true, response: { generateVideoResponse: { raiMediaFilteredCount: 1, raiMediaFilteredReasons: ["filtered"] } } },
  operationFailed: { name: "models/veo-3.1-fast-generate-preview/operations/8f3k2n1x", done: true, error: { code: 13, message: "Internal error." } },
  model: { name: "models/veo-3.1-fast-generate-preview", displayName: "Veo 3.1 Fast", supportedGenerationMethods: ["predictLongRunning"] },
  // HTTP 400, recorded live with a well-formed but unknown key.
  invalidKey: {
    error: {
      code: 400,
      message: "API key not valid. Please pass a valid API key.",
      status: "INVALID_ARGUMENT",
      details: [
        { "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "API_KEY_INVALID", domain: "googleapis.com", metadata: { service: "generativelanguage.googleapis.com" } },
        { "@type": "type.googleapis.com/google.rpc.LocalizedMessage", locale: "en-US", message: "API key not valid. Please pass a valid API key." },
      ],
    },
  },
  // HTTP 403, recorded live without a key.
  noKey: {
    error: {
      code: 403,
      message: "Method doesn't allow unregistered callers (callers without established identity). Please use API Key or other form of API consumer identity to call this API.",
      status: "PERMISSION_DENIED",
    },
  },
  // The documented google.rpc.Status bodies for the other refusals.
  region: { error: { code: 400, message: "User location is not supported for the API use.", status: "FAILED_PRECONDITION" } },
  quota: { error: { code: 429, message: "You exceeded your current quota.", status: "RESOURCE_EXHAUSTED" } },
} as const;

// fal queue (https://fal.ai/docs/model-apis/model-endpoints/queue) and
// platform API (https://fal.ai/docs/platform-apis/v1/models/pricing).
export const fal = {
  submitted: (endpoint: string) => ({
    request_id: "764cabcf-b745-4b3e-ae38-1200304cf45b",
    response_url: `https://queue.fal.run/${endpoint.split("/").slice(0, 2).join("/")}/requests/764cabcf-b745-4b3e-ae38-1200304cf45b`,
    status_url: `https://queue.fal.run/${endpoint.split("/").slice(0, 2).join("/")}/requests/764cabcf-b745-4b3e-ae38-1200304cf45b/status`,
    cancel_url: `https://queue.fal.run/${endpoint.split("/").slice(0, 2).join("/")}/requests/764cabcf-b745-4b3e-ae38-1200304cf45b/cancel`,
    queue_position: 0,
  }),
  inQueue: { status: "IN_QUEUE", request_id: "764cabcf-b745-4b3e-ae38-1200304cf45b", queue_position: 2 },
  inProgress: { status: "IN_PROGRESS", request_id: "764cabcf-b745-4b3e-ae38-1200304cf45b", logs: [{ message: "Generating...", timestamp: "2026-10-05T10:30:01.123Z" }] },
  completed: { status: "COMPLETED", request_id: "764cabcf-b745-4b3e-ae38-1200304cf45b", logs: [], metrics: { inference_time: 41.2 }, error: null, error_type: null },
  // The output schemas' required fields: Kling { video }, Seedance { video, seed }.
  output: { video: { url: "https://v3b.fal.media/files/b/0a8cfc9f/output.mp4", content_type: "video/mp4", file_name: "output.mp4", file_size: 1843921 }, seed: 1234 },
  pricing: (endpoint: string) => ({ prices: [{ endpoint_id: endpoint, unit_price: 0.084, unit: "second", currency: "USD" }], next_cursor: null, has_more: false }),
  // Recorded live: HTTP 401 from the queue and from the platform API.
  queueInvalidKey: { detail: "invalid key credentials" },
  platformInvalidKey: { error: { type: "authorization_error", message: "Invalid API key" } },
  // HTTP 403 for an account whose balance is spent. Not recorded here (it
  // needs such an account); worded as fal users report it. Only the word
  // "balance" is read.
  exhaustedBalance: { detail: "User is locked. Reason: Exhausted balance. Top up your balance at fal.ai/dashboard/billing." },
} as const;
