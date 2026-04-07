import { useState } from "react";
import { Layout } from "@/components/layout";
import { useBrandContext } from "@/hooks/use-brand-context";
import { useMapBrand, MemoResponse } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Map as MapIcon, Loader2, Compass } from "lucide-react";
import { MemoResponseView } from "@/components/memo-response";
import { ModelSelector } from "@/components/model-selector";
import { useModelContext } from "@/contexts/model-context";
import { useToast } from "@/hooks/use-toast";

export default function BrandMapping() {
  const { activeBrandId } = useBrandContext();
  const { synthesisModel } = useModelContext();
  const { toast } = useToast();
  
  const [question, setQuestion] = useState("");
  const [response, setResponse] = useState<MemoResponse | null>(null);

  const mapBrand = useMapBrand();

  const handleMap = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim() || !activeBrandId) return;

    try {
      const result = await mapBrand.mutateAsync({
        data: {
          brandId: activeBrandId,
          question,
          synthesisModel,
        }
      });
      setResponse(result);
    } catch (error) {
      toast({ title: "Failed to map brand strategy", variant: "destructive" });
    }
  };

  return (
    <Layout>
      <div className="space-y-8 max-w-4xl mx-auto">
        <div className="relative text-center space-y-3 py-6">
          <div className="absolute right-0 top-6">
            <ModelSelector />
          </div>
          <div className="mx-auto h-16 w-16 bg-primary/10 flex items-center justify-center rounded-2xl mb-4">
            <MapIcon className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Brand Mapping</h1>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Map established intelligence directly to your brand profile to uncover specific strategic alignments, gaps, and execution paths.
          </p>
        </div>

        {!activeBrandId ? (
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="p-6 text-center text-destructive">
              Please select or create an active brand from the Brand Profile page to use mapping.
            </CardContent>
          </Card>
        ) : (
          <Card className="border-2 border-primary/20 shadow-md">
            <CardContent className="p-6">
              <form onSubmit={handleMap} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="mapping-query">Strategic Mapping Focus</Label>
                  <div className="relative">
                    <Compass className="absolute left-4 top-4 h-5 w-5 text-muted-foreground" />
                    <Input 
                      id="mapping-query"
                      className="pl-12 h-14 text-lg border-muted-foreground/20 focus-visible:ring-primary shadow-inner"
                      placeholder="e.g. Map our positioning against current GEO best practices"
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      disabled={mapBrand.isPending}
                    />
                  </div>
                </div>
                <div className="flex justify-end pt-2">
                  <Button type="submit" size="lg" className="px-8 font-semibold" disabled={!question.trim() || mapBrand.isPending}>
                    {mapBrand.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Generating Mapping
                      </>
                    ) : (
                      "Map Strategy"
                    )}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {response && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 pt-4">
            <MemoResponseView memo={response} />
          </div>
        )}
      </div>
    </Layout>
  );
}
