export type SynthesisModelId =
  | "gpt-4o"
  | "gpt-4o-mini"
  | "claude-opus-4-6"
  | "claude-sonnet-4-6"
  | "claude-haiku-4-5"
  | "gemini-3.1-pro-preview"
  | "gemini-2.5-pro"
  | "gemini-3-flash-preview";

export const DEFAULT_MODEL: SynthesisModelId = "gpt-4o";

export const MODEL_OPTIONS: Array<{
  id: SynthesisModelId;
  label: string;
  provider: "openai" | "anthropic" | "gemini";
  tier: "fast" | "strong";
  description: string;
}> = [
  {
    id: "gpt-4o",
    label: "GPT-4o",
    provider: "openai",
    tier: "strong",
    description: "OpenAI flagship — best overall quality",
  },
  {
    id: "gpt-4o-mini",
    label: "GPT-4o Mini",
    provider: "openai",
    tier: "fast",
    description: "OpenAI fast — lower cost, good quality",
  },
  {
    id: "claude-opus-4-6",
    label: "Claude Opus 4.6",
    provider: "anthropic",
    tier: "strong",
    description: "Anthropic most capable — deep reasoning",
  },
  {
    id: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    provider: "anthropic",
    tier: "strong",
    description: "Anthropic balanced — speed + quality",
  },
  {
    id: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    provider: "anthropic",
    tier: "fast",
    description: "Anthropic fast — compact and quick",
  },
  {
    id: "gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro",
    provider: "gemini",
    tier: "strong",
    description: "Google latest — most powerful Gemini",
  },
  {
    id: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    provider: "gemini",
    tier: "strong",
    description: "Google pro — complex reasoning",
  },
  {
    id: "gemini-3-flash-preview",
    label: "Gemini 3 Flash",
    provider: "gemini",
    tier: "fast",
    description: "Google fast — high-volume tasks",
  },
];

export const PROVIDER_COLORS: Record<string, string> = {
  openai: "text-emerald-700 bg-emerald-50 border-emerald-200",
  anthropic: "text-orange-700 bg-orange-50 border-orange-200",
  gemini: "text-blue-700 bg-blue-50 border-blue-200",
};

export const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google",
};

export function getModelOption(id: SynthesisModelId) {
  return MODEL_OPTIONS.find((m) => m.id === id) ?? MODEL_OPTIONS[0];
}
