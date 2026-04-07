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
