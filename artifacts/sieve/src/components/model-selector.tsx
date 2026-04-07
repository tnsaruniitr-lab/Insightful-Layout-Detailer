import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  MODEL_OPTIONS,
  PROVIDER_COLORS,
  PROVIDER_LABELS,
  getModelOption,
  type SynthesisModelId,
} from "@/lib/models";
import { useModelContext } from "@/contexts/model-context";
import { Cpu } from "lucide-react";

const providers = ["openai", "anthropic", "gemini"] as const;

interface ModelSelectorProps {
  className?: string;
  compact?: boolean;
}

export function ModelSelector({ className = "", compact = false }: ModelSelectorProps) {
  const { synthesisModel, setSynthesisModel } = useModelContext();
  const current = getModelOption(synthesisModel);

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {!compact && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Cpu className="h-3.5 w-3.5" />
          <span className="font-medium">Synthesis Model</span>
        </div>
      )}
      <Select value={synthesisModel} onValueChange={(v) => setSynthesisModel(v as SynthesisModelId)}>
        <SelectTrigger className="w-auto min-w-[180px] h-8 text-xs">
          <SelectValue>
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className={`text-[9px] font-mono uppercase px-1 py-0 ${PROVIDER_COLORS[current.provider]}`}
              >
                {PROVIDER_LABELS[current.provider]}
              </Badge>
              <span>{current.label}</span>
              {current.tier === "fast" && (
                <Badge variant="secondary" className="text-[9px] px-1 py-0">fast</Badge>
              )}
            </div>
          </SelectValue>
        </SelectTrigger>
        <SelectContent className="w-[280px]">
          {providers.map((provider) => {
            const providerModels = MODEL_OPTIONS.filter((m) => m.provider === provider);
            return (
              <SelectGroup key={provider}>
                <SelectLabel className={`text-xs font-bold uppercase tracking-wider mx-1 my-1 px-2 py-1 rounded ${PROVIDER_COLORS[provider]}`}>
                  {PROVIDER_LABELS[provider]}
                </SelectLabel>
                {providerModels.map((model) => (
                  <SelectItem key={model.id} value={model.id} className="text-sm">
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{model.label}</span>
                        {model.tier === "fast" && (
                          <Badge variant="secondary" className="text-[9px] px-1 py-0">fast</Badge>
                        )}
                        {model.id === "gpt-4o" && (
                          <Badge variant="outline" className="text-[9px] px-1 py-0 text-emerald-700 border-emerald-300">default</Badge>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground">{model.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectGroup>
            );
          })}
          <div className="px-2 py-2 border-t mt-1">
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              Embeddings (vector search) always use OpenAI — not affected by this selection.
            </p>
          </div>
        </SelectContent>
      </Select>
    </div>
  );
}
