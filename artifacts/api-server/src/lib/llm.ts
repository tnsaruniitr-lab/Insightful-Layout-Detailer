import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { logger } from "./logger";

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

export function createStrongModel(): ChatOpenAI {
  return new ChatOpenAI({
    model: "gpt-4o",
    openAIApiKey: requireEnv("AI_INTEGRATIONS_OPENAI_API_KEY"),
    configuration: {
      baseURL: requireEnv("AI_INTEGRATIONS_OPENAI_BASE_URL"),
    },
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

export function validateLLMConfig(): void {
  const missing: string[] = [];
  if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) missing.push("AI_INTEGRATIONS_OPENAI_API_KEY");
  if (!process.env.AI_INTEGRATIONS_OPENAI_BASE_URL) missing.push("AI_INTEGRATIONS_OPENAI_BASE_URL");
  if (!process.env.OPENAI_API_KEY) missing.push("OPENAI_API_KEY");
  if (missing.length > 0) {
    logger.warn({ missing }, "LLM environment variables not fully configured");
  }
}
