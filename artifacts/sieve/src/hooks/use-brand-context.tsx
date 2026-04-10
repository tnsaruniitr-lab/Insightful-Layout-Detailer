import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { getGetBrandQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

interface BrandContextType {
  activeBrandId: number | null;
  setActiveBrandId: (id: number) => void;
}

const BrandContext = createContext<BrandContextType | undefined>(undefined);

const FALLBACK_BRAND_ID = 2;
const API_BASE = (import.meta.env.BASE_URL ?? "").replace(/\/$/, "");

export function BrandProvider({ children }: { children: React.ReactNode }) {
  const [activeBrandId, setActiveBrandIdState] = useState<number | null>(() => {
    const saved = localStorage.getItem("sieve_active_brand");
    return saved ? parseInt(saved, 10) : FALLBACK_BRAND_ID;
  });
  const queryClient = useQueryClient();
  const validated = useRef(false);

  const setActiveBrandId = (id: number) => {
    setActiveBrandIdState(id);
    localStorage.setItem("sieve_active_brand", id.toString());
  };

  useEffect(() => {
    if (validated.current || !activeBrandId) return;
    validated.current = true;
    fetch(`${API_BASE}/api/brands/${activeBrandId}`)
      .then((res) => {
        if (!res.ok) {
          setActiveBrandId(FALLBACK_BRAND_ID);
          queryClient.invalidateQueries({ queryKey: getGetBrandQueryKey(FALLBACK_BRAND_ID) });
        }
      })
      .catch(() => setActiveBrandId(FALLBACK_BRAND_ID));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <BrandContext.Provider value={{ activeBrandId, setActiveBrandId }}>
      {children}
    </BrandContext.Provider>
  );
}

export function useBrandContext() {
  const context = useContext(BrandContext);
  if (context === undefined) {
    throw new Error("useBrandContext must be used within a BrandProvider");
  }
  return context;
}
