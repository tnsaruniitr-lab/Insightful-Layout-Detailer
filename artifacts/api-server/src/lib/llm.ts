import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { logger } from "./logger";

export type SynthesisModelId =
  | "gpt-4o"
  | "gpt-4o-mini"
  | "claude-opus-4-6"
  | "claude-sonnet-4-6"
  | "claude-haiku-4-5"
  | "gemini-3.1-pro-preview"
  | "gemini-2.5-pro"
  | "gemini-3-flash-preview";

export const DEFAULT_SYNTHESIS_MODEL: SynthesisModelId = "gpt-4o";

export const SYNTHESIS_MODEL_OPTIONS: Array<{
  id: SynthesisModelId;
  label: string;
  provider: "openai" | "anthropic" | "gemini";
  tier: "fast" | "strong";
}> = [
  { id: "gpt-4o", label: "GPT-4o", provider: "openai", tier: "strong" },
  { id: "gpt-4o-mini", label: "GPT-4o Mini", provider: "openai", tier: "fast" },
  { id: "claude-opus-4-6", label: "Claude Opus 4.6", provider: "anthropic", tier: "strong" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", provider: "anthropic", tier: "strong" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", provider: "anthropic", tier: "fast" },
  { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", provider: "gemini", tier: "strong" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: "gemini", tier: "strong" },
  { id: "gemini-3-flash-preview", label: "Gemini 3 Flash", provider: "gemini", tier: "fast" },
];

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

export function createFastModel(): ChatOpenAI {
  return new ChatOpenAI({
    model: "gpt-4o-mini",
    openAIApiKey: requireEnv("AI_INTEGRATIONS_OPENAI_API_KEY"),
    configuration: {
      baseURL: requireEnv("AI_INTEGRATIONS_OPENAI_BASE_URL"),
    },
    maxRetries: 2,
  });
}

export function createStrongModel(): ChatAnthropic {
  return new ChatAnthropic({
    model: "claude-sonnet-4-6",
    apiKey: requireEnv("AI_INTEGRATIONS_ANTHROPIC_API_KEY"),
    anthropicApiUrl: requireEnv("AI_INTEGRATIONS_ANTHROPIC_BASE_URL"),
    maxRetries: 2,
  });
}

export function createEmbeddings(): OpenAIEmbeddings {
  // Note: The Replit AI Integration proxy (AI_INTEGRATIONS_OPENAI_BASE_URL) only proxies
  // chat completions — it does not support the /v1/embeddings endpoint. Embeddings therefore
  // use OPENAI_API_KEY directly against the official OpenAI API. This is the correct and
  // only supported approach in this environment.
  return new OpenAIEmbeddings({
    model: "text-embedding-3-small",
    openAIApiKey: requireEnv("OPENAI_API_KEY"),
    maxRetries: 2,
  });
}

/**
 * Unified synthesis invocation. Calls the appropriate provider based on modelId.
 * Always returns the text string from the model response.
 */
export async function invokeSynthesisModel(
  modelId: SynthesisModelId,
  systemPrompt: string,
  userPrompt: string,
  retries = 2
): Promise<string> {
  const attempt = async (): Promise<string> => {
    if (modelId === "gpt-4o" || modelId === "gpt-4o-mini") {
      const { HumanMessage, SystemMessage } = await import("@langchain/core/messages");
      const model = new ChatOpenAI({
        model: modelId,
        openAIApiKey: requireEnv("AI_INTEGRATIONS_OPENAI_API_KEY"),
        configuration: { baseURL: requireEnv("AI_INTEGRATIONS_OPENAI_BASE_URL") },
        maxRetries: 0,
      });
      const response = await model.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(userPrompt),
      ]);
      return typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);
    }

    if (modelId.startsWith("claude-")) {
      const anthropic = new Anthropic({
        apiKey: requireEnv("AI_INTEGRATIONS_ANTHROPIC_API_KEY"),
        baseURL: requireEnv("AI_INTEGRATIONS_ANTHROPIC_BASE_URL"),
      });
      const message = await anthropic.messages.create({
        model: modelId,
        max_tokens: 8192,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      });
      const block = message.content[0];
      return block.type === "text" ? block.text : "";
    }

    if (modelId.startsWith("gemini-")) {
      const ai = new GoogleGenAI({
        apiKey: requireEnv("AI_INTEGRATIONS_GEMINI_API_KEY"),
        httpOptions: { baseUrl: requireEnv("AI_INTEGRATIONS_GEMINI_BASE_URL") },
      });
      const response = await ai.models.generateContent({
        model: modelId,
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        config: {
          systemInstruction: systemPrompt,
          maxOutputTokens: 8192,
        },
      });
      return response.text ?? "";
    }

    throw new Error(`Unknown synthesis model: ${modelId}`);
  };

  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await attempt();
    } catch (err) {
      lastErr = err;
      if (i < retries) {
        logger.warn({ err, model: modelId, attempt: i }, "Synthesis model retry");
        await new Promise((r) => setTimeout(r, 500 * (i + 1)));
      }
    }
  }
  throw lastErr;
}

export function validateLLMConfig(): void {
  const missing: string[] = [];
  if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) missing.push("AI_INTEGRATIONS_OPENAI_API_KEY");
  if (!process.env.AI_INTEGRATIONS_OPENAI_BASE_URL) missing.push("AI_INTEGRATIONS_OPENAI_BASE_URL");
  if (!process.env.OPENAI_API_KEY) missing.push("OPENAI_API_KEY");
  if (!process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY) missing.push("AI_INTEGRATIONS_ANTHROPIC_API_KEY");
  if (!process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL) missing.push("AI_INTEGRATIONS_ANTHROPIC_BASE_URL");
  if (!process.env.AI_INTEGRATIONS_GEMINI_API_KEY) missing.push("AI_INTEGRATIONS_GEMINI_API_KEY");
  if (!process.env.AI_INTEGRATIONS_GEMINI_BASE_URL) missing.push("AI_INTEGRATIONS_GEMINI_BASE_URL");
  if (missing.length > 0) {
    logger.warn({ missing }, "LLM environment variables not fully configured");
  }
}
