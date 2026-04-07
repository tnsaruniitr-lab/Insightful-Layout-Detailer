import { useState, useEffect, useRef } from "react";
import { Layout } from "@/components/layout";
import { useBrandContext } from "@/hooks/use-brand-context";
import { useGetBrandStrategy, MemoResponse } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Settings2, Loader2, ArrowRightCircle, AlertCircle, RefreshCw } from "lucide-react";
import { MemoResponseView } from "@/components/memo-response";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

export default function StrategyOutput() {
  const { activeBrandId } = useBrandContext();
  const { toast } = useToast();

  const [response, setResponse] = useState<MemoResponse | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const hasAutoTriggered = useRef(false);

  const getStrategy = useGetBrandStrategy();

  const handleGenerate = async () => {
    if (!activeBrandId) return;
    setSubmitError(null);

    try {
      const result = await getStrategy.mutateAsync({
        data: { brandId: activeBrandId },
      });
      setResponse(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to generate strategy output";
      setSubmitError(msg);
      toast({ title: "Strategy generation failed", description: msg, variant: "destructive" });
    }
  };

  useEffect(() => {
    if (activeBrandId && !hasAutoTriggered.current && !response) {
      hasAutoTriggered.current = true;
      handleGenerate();
    }
  }, [activeBrandId]);

  return (
    <Layout>
      <div className="space-y-8 max-w-4xl mx-auto">
        <div className="text-center space-y-3 py-6">
          <div className="mx-auto h-16 w-16 bg-primary/10 flex items-center justify-center rounded-2xl mb-4">
            <Settings2 className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Strategy Output</h1>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Comprehensive "Where to Start" recommendations based on complete brand intelligence, rules, and playbooks.
          </p>
        </div>

        {!activeBrandId ? (
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="p-8 flex flex-col items-center gap-3 text-center">
              <AlertCircle className="h-8 w-8 text-destructive" />
              <p className="font-medium text-destructive">No brand configured</p>
              <p className="text-sm text-muted-foreground">
                Select or create an active brand from the Brand Profile page to generate a strategy.
              </p>
              <Button variant="outline" asChild>
                <Link href="/brand">Go to Brand Profile</Link>
              </Button>
            </CardContent>
          </Card>
        ) : submitError ? (
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="p-8 flex flex-col items-center gap-3 text-center">
              <AlertCircle className="h-8 w-8 text-destructive" />
              <p className="font-medium text-destructive">Strategy generation failed</p>
              <p className="text-sm text-muted-foreground max-w-sm">{submitError}</p>
              <Button variant="outline" size="sm" onClick={handleGenerate} disabled={getStrategy.isPending}>
                <RefreshCw className="h-3.5 w-3.5 mr-2" />
                Try Again
              </Button>
            </CardContent>
          </Card>
        ) : getStrategy.isPending ? (
          <Card className="border-2 border-primary/20 bg-muted/10 shadow-sm overflow-hidden">
            <div className="h-1 bg-gradient-to-r from-primary/40 via-primary to-primary/40" />
            <CardContent className="p-12 text-center flex flex-col items-center justify-center min-h-[300px] gap-5">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <div className="space-y-1">
                <h3 className="text-xl font-serif font-bold">Synthesizing Strategy...</h3>
                <p className="text-muted-foreground text-sm max-w-md mx-auto">
                  Evaluating your brand against all canonical playbooks, rules, and principles.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : !response ? (
          <Card className="border-2 border-primary/20 bg-muted/10 shadow-sm overflow-hidden">
            <div className="h-1 bg-gradient-to-r from-primary/40 via-primary to-primary/40" />
            <CardContent className="p-12 text-center flex flex-col items-center justify-center min-h-[300px]">
              <h3 className="text-xl font-serif font-bold mb-4">Ready for Synthesis</h3>
              <p className="text-muted-foreground max-w-md mx-auto mb-8 text-sm">
                The engine will evaluate your active brand against all canonical playbooks, rules, and principles
                to determine the highest-leverage starting points.
              </p>
              <Button
                onClick={handleGenerate}
                size="lg"
                className="px-8 font-semibold h-14 text-lg w-full max-w-sm shadow-md"
                disabled={getStrategy.isPending}
              >
                Generate Action Plan <ArrowRightCircle className="ml-3 h-5 w-5" />
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setResponse(null); hasAutoTriggered.current = false; }}>
                Clear Output
              </Button>
              <Button variant="outline" onClick={handleGenerate} disabled={getStrategy.isPending}>
                {getStrategy.isPending ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Regenerating...</>
                ) : (
                  <><RefreshCw className="h-4 w-4 mr-2" />Regenerate</>
                )}
              </Button>
            </div>
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <MemoResponseView memo={response} />
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
