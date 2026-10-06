import { z } from "zod";

// What a cloud provider's error response means, said as what to do next.
// Shapes recorded from the live APIs on 2026-10-05 (provider-fixtures.ts).
// Messages never quote the upstream body: only its documented codes are read.

export type ProviderProblem =
  | "auth"
  | "permission"
  | "region"
  | "billing"
  | "quota"
  | "not-found"
  | "rejected"
  | "unavailable";

export interface ProviderError {
  problem: ProviderProblem;
  message: string;
}

// google.rpc.Status, as the Gemini API returns it.
const GoogleError = z.object({
  error: z.object({
    code: z.number().optional(),
    status: z.string().optional(),
    message: z.string().optional(),
    details: z.array(z.object({ reason: z.string().optional() }).passthrough()).optional(),
  }),
});

export function googleError(status: number, body: unknown): ProviderError {
  const parsed = GoogleError.safeParse(body);
  const error = parsed.success ? parsed.data.error : undefined;
  const reasons = new Set((error?.details ?? []).map((d) => d.reason).filter(Boolean));
  const said = error?.message ?? "";
  if (reasons.has("API_KEY_INVALID") || reasons.has("API_KEY_EXPIRED") || status === 401) {
    return {
      problem: "auth",
      message:
        "Google rejected this API key: it is mistyped, deleted or expired. Create one at aistudio.google.com/apikey.",
    };
  }
  if (/location is not supported/i.test(said)) {
    return {
      problem: "region",
      message:
        "The Gemini API does not serve this server's region. Run Troupe from a supported country, or use another provider.",
    };
  }
  // Sent without a key, or with one Google cannot tie to a project.
  if (/unregistered callers|without established identity/i.test(said)) {
    return {
      problem: "auth",
      message: "Google received no usable API key. Save the key again in Settings, or set GEMINI_API_KEY.",
    };
  }
  if (error?.status === "PERMISSION_DENIED" || status === 403) {
    return {
      problem: "permission",
      message:
        "Google refused this key access to the Gemini API: enable the Generative Language API on the key's project, or lift the key's API restrictions.",
    };
  }
  if (error?.status === "FAILED_PRECONDITION") {
    return {
      problem: "billing",
      message:
        "Google refused the request for this key's project: Veo needs a paid, billing-enabled Gemini API project in a supported region.",
    };
  }
  if (error?.status === "RESOURCE_EXHAUSTED" || status === 429) {
    return {
      problem: "quota",
      message:
        "This key has no Gemini API quota left for this model: wait for it to reset, or raise it in Google AI Studio. On a free-tier key there is none for Veo: Veo needs a paid (billing-enabled) project.",
    };
  }
  if (status === 404 || error?.status === "NOT_FOUND")
    return { problem: "not-found", message: "Google does not offer this model to the key. Check the model id." };
  if (status === 400)
    return {
      problem: "rejected",
      message: "Google rejected the request's settings. Check the model's formats and lengths in Settings.",
    };
  return { problem: "unavailable", message: `Google returned HTTP ${status}. Try again later.` };
}

// fal answers {"detail": "..."} on its queue and {"error": {"type", "message"}}
// on its platform API.
const FalError = z.object({
  detail: z.unknown().optional(),
  error: z.object({ type: z.string().optional(), message: z.string().optional() }).optional(),
});

export function falError(status: number, body: unknown): ProviderError {
  const parsed = FalError.safeParse(body);
  const detail = parsed.success
    ? `${typeof parsed.data.detail === "string" ? parsed.data.detail : ""} ${parsed.data.error?.message ?? ""}`
    : "";
  if (/balance|locked|billing|credit/i.test(detail)) {
    return {
      problem: "billing",
      message: "fal.ai refused the job: the account has no balance left. Top it up at fal.ai/dashboard/billing.",
    };
  }
  if (status === 401)
    return {
      problem: "auth",
      message: "fal.ai rejected this API key: it is mistyped or was revoked. Create one at fal.ai/dashboard/keys.",
    };
  if (status === 403)
    return {
      problem: "permission",
      message: "fal.ai accepted the key but refused it this endpoint. Check the key's scope and the account's access.",
    };
  if (status === 429)
    return { problem: "quota", message: "fal.ai is limiting requests from this account. Try again in a minute." };
  if (status === 404) return { problem: "not-found", message: "fal.ai has no such endpoint. Check the model id." };
  if (status === 400 || status === 422)
    return {
      problem: "rejected",
      message: "fal.ai rejected the request's settings. Check the model's formats and lengths in Settings.",
    };
  return { problem: "unavailable", message: `fal.ai returned HTTP ${status}. Try again later.` };
}

// The adapter error code a problem is reported under on a failed launch.
export const PROBLEM_CODE: Record<ProviderProblem, string> = {
  auth: "PROVIDER_AUTH",
  permission: "PROVIDER_PERMISSION",
  region: "PROVIDER_REGION",
  billing: "PROVIDER_BILLING",
  quota: "PROVIDER_QUOTA",
  "not-found": "PROVIDER_MODEL_NOT_FOUND",
  rejected: "PROVIDER_REJECTED",
  unavailable: "PROVIDER_HTTP",
};
