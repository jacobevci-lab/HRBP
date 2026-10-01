import { runtimeString } from "@/lib/runtime-env";

type AIDispatchInput = {
  interactionId: string;
  tenantId: string;
  actorId: string;
  prompt: string;
  module: string;
  purpose: string;
  classification: string;
  restrictedDataAccess: boolean;
  sourceRefs?: string[];
};

type SynchronousProcessorResult = {
  response: string;
  modelProvider: string;
  modelName: string;
};

function validSynchronousResult(value: unknown): SynchronousProcessorResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as { response?: unknown; modelProvider?: unknown; modelName?: unknown };
  const response = typeof raw.response === "string" ? raw.response.trim() : "";
  const modelProvider = typeof raw.modelProvider === "string" ? raw.modelProvider.trim() : "";
  const modelName = typeof raw.modelName === "string" ? raw.modelName.trim() : "";
  if (!response || response.length > 32_000 || !modelProvider || modelProvider.length > 120 || !modelName || modelName.length > 160) return null;
  return { response, modelProvider, modelName };
}

export async function dispatchAIInteraction(input: AIDispatchInput) {
  const endpoint = runtimeString("HRBP_AI_PROCESSOR_URL");
  const token = runtimeString("HRBP_AI_PROCESSOR_TOKEN");
  if (!endpoint || !token || token.length < 24) {
    return { dispatched: false as const, reason: "PROCESSOR_NOT_CONFIGURED" as const };
  }

  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return { dispatched: false as const, reason: "PROCESSOR_URL_INVALID" as const };
  }
  if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.protocol === "http:")) {
    return { dispatched: false as const, reason: "PROCESSOR_URL_INSECURE" as const };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        interactionId: input.interactionId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        prompt: input.prompt,
        module: input.module,
        purpose: input.purpose,
        classification: input.classification,
        restrictedDataAccess: input.restrictedDataAccess,
        sourceRefs: input.sourceRefs ?? []
      }),
      signal: controller.signal,
      cache: "no-store"
    });

    if (response.status === 202) return { dispatched: true as const, mode: "async" as const };
    if (!response.ok) {
      return { dispatched: false as const, reason: "PROCESSOR_REJECTED" as const, status: response.status };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { dispatched: false as const, reason: "PROCESSOR_RESPONSE_INVALID" as const };
    }
    const completed = validSynchronousResult(payload);
    if (!completed) return { dispatched: false as const, reason: "PROCESSOR_RESPONSE_INVALID" as const };
    return { dispatched: true as const, mode: "sync" as const, completed };
  } catch (error) {
    const reason = error instanceof Error && error.name === "AbortError" ? "PROCESSOR_TIMEOUT" : "PROCESSOR_UNAVAILABLE";
    return { dispatched: false as const, reason };
  } finally {
    clearTimeout(timeout);
  }
}
