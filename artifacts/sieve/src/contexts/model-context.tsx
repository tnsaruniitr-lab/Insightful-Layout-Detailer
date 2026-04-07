import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { DEFAULT_MODEL, type SynthesisModelId } from "@/lib/models";

const STORAGE_KEY = "sieve_synthesis_model";

function readStoredModel(): SynthesisModelId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return stored as SynthesisModelId;
  } catch {}
  return DEFAULT_MODEL;
}

interface ModelContextValue {
  synthesisModel: SynthesisModelId;
  setSynthesisModel: (model: SynthesisModelId) => void;
}

const ModelContext = createContext<ModelContextValue>({
  synthesisModel: DEFAULT_MODEL,
  setSynthesisModel: () => {},
});

export function ModelProvider({ children }: { children: ReactNode }) {
  const [synthesisModel, setSynthesisModelState] = useState<SynthesisModelId>(readStoredModel);

  const setSynthesisModel = useCallback((model: SynthesisModelId) => {
    setSynthesisModelState(model);
    try { localStorage.setItem(STORAGE_KEY, model); } catch {}
  }, []);

  return (
    <ModelContext.Provider value={{ synthesisModel, setSynthesisModel }}>
      {children}
    </ModelContext.Provider>
  );
}

export function useModelContext() {
  return useContext(ModelContext);
}
