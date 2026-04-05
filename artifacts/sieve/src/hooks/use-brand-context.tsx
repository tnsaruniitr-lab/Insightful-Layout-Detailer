import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { useCreateBrand, getGetBrandQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

interface BrandContextType {
  activeBrandId: number | null;
  setActiveBrandId: (id: number) => void;
}

const BrandContext = createContext<BrandContextType | undefined>(undefined);

export function BrandProvider({ children }: { children: React.ReactNode }) {
  const [activeBrandId, setActiveBrandId] = useState<number | null>(() => {
    const saved = localStorage.getItem("sieve_active_brand");
    return saved ? parseInt(saved, 10) : null;
  });
  const createBrand = useCreateBrand();
  const queryClient = useQueryClient();
  const bootstrapped = useRef(false);

  useEffect(() => {
    if (activeBrandId) {
      localStorage.setItem("sieve_active_brand", activeBrandId.toString());
    }
  }, [activeBrandId]);

  useEffect(() => {
    if (!activeBrandId && !bootstrapped.current) {
      bootstrapped.current = true;
      createBrand.mutate(
        { data: { name: "Default Brand", icpDescription: "Default ICP for your brand" } },
        {
          onSuccess: (brand) => {
            setActiveBrandId(brand.id);
            queryClient.invalidateQueries({ queryKey: getGetBrandQueryKey(brand.id) });
          },
          onError: () => {
            bootstrapped.current = false;
          },
        }
      );
    }
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
