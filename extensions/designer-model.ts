import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const kimiK3 = {
  id: "accounts/fireworks/models/kimi-k3",
  name: "Kimi K3",
  api: "openai-completions" as const,
  reasoning: true,
  input: ["text", "image"] as Array<"text" | "image">,
  cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 0 },
  contextWindow: 1_048_576,
  maxTokens: 131_072,
  thinkingLevelMap: {
    off: null,
    minimal: "low",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "high",
    max: "high",
  },
  compat: {
    deferredToolsMode: "kimi" as const,
    requiresReasoningContentOnAssistantMessages: true,
    supportsStrictMode: true,
    supportsDeveloperRole: false,
    thinkingFormat: "openai" as const,
    sendSessionAffinityHeaders: true,
  },
};

export default function (pi: ExtensionAPI) {
  pi.registerProvider("fireworks", {
    baseUrl: "https://api.fireworks.ai/inference/v1",
    api: "openai-completions",
    models: [kimiK3],
  });
}
