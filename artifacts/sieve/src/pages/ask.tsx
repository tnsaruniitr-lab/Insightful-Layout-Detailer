import { useState } from "react";
import { Layout } from "@/components/layout";
import { useBrandContext } from "@/hooks/use-brand-context";
import { useAskBrain, MemoResponse } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { BrainCircuit, Loader2, Search, Globe, Building2, AlertCircle } from "lucide-react";
import { MemoResponseView } from "@/components/memo-response";
import { ModelSelector } from "@/components/model-selector";
import { useModelContext } from "@/contexts/model-context";
import { useToast } from "@/hooks/use-toast";

type AskMode = "general" | "brand";

export default function AskBrain() {
  const { activeBrandId } = useBrandContext();
  const { synthesisModel } = useModelContext();
  const { toast } = useToast();

  const [question, setQuestion] = useState("");
  const [mode, setMode] = useState<AskMode>("general");
  const [response, setResponse] = useState<MemoResponse | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const askBrain = useAskBrain();

  const handleAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;
    setSubmitError(null);
    setResponse(null);

    try {
      const result = await askBrain.mutateAsync({
        data: {
          question,
          brandId: mode === "brand" && activeBrandId ? activeBrandId : undefined,
          useBrandContext: mode === "brand",
          synthesisModel,
        },
      });
      setResponse(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "An unexpected error occurred";
      setSubmitError(msg);
      toast({ title: "Failed to process query", description: msg, variant: "destructive" });
    }
  };

  const hasBrand = !!activeBrandId;

  return (
    <Layout>
      <div className="space-y-8 max-w-4xl mx-auto">
        <div className="text-center space-y-2 py-4">
          <div className="mx-auto h-14 w-14 bg-primary/10 flex items-center justify-center rounded-2xl mb-3">
            <BrainCircuit className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Ask the Brain</h1>
          <p className="text-muted-foreground max-w-xl mx-auto text-sm">
            Query the compiled knowledge base. The intelligence engine will synthesize principles, rules, and playbooks to answer your strategic questions.
          </p>
        </div>

        <Card className="border-2 border-primary/20 shadow-md">
          <CardContent className="p-6">
            <form onSubmit={handleAsk} className="space-y-4">
              <div className="relative">
                <Search className="absolute left-4 top-4 h-5 w-5 text-muted-foreground" />
                <Input
                  className="pl-12 h-14 text-base border-muted-foreground/20 focus-visible:ring-primary"
                  placeholder="e.g. What are the canonical principles for programmatic SEO?"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  disabled={askBrain.isPending}
                />
              </div>

              <div className="flex items-center justify-end">
                <ModelSelector />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
                  <button
                    type="button"
                    onClick={() => setMode("general")}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      mode === "general"
                        ? "bg-background shadow text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Globe className="h-4 w-4" />
                    General
                  </button>

                  {hasBrand ? (
                    <button
                      type="button"
                      onClick={() => setMode("brand")}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                        mode === "brand"
                          ? "bg-background shadow text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Building2 className="h-4 w-4" />
                      Brand-aware
                    </button>
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground/50 cursor-not-allowed"
                        >
                          <Building2 className="h-4 w-4" />
                          Brand-aware
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        Configure a brand profile first to enable brand-aware queries.
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>

                <Button
                  type="submit"
                  size="lg"
                  className="px-8 font-semibold"
                  disabled={!question.trim() || askBrain.isPending}
                >
                  {askBrain.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    "Submit Query"
                  )}
                </Button>
              </div>

              {mode === "brand" && hasBrand && (
                <p className="text-xs text-muted-foreground">
                  Brand context will be applied to focus the analysis on your brand's positioning and ICP.
                </p>
              )}
            </form>
          </CardContent>
        </Card>

        {submitError && !askBrain.isPending && (
          <div className="flex items-start gap-3 p-4 rounded-md border border-destructive/30 bg-destructive/5 text-destructive">
            <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-sm">The intelligence pipeline encountered an error</p>
              <p className="text-sm mt-0.5 text-destructive/80">{submitError}</p>
              <button
                type="button"
                onClick={() => setSubmitError(null)}
                className="text-xs underline mt-1 hover:no-underline"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {response && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-300 pt-2">
            <MemoResponseView memo={response} />
          </div>
        )}
      </div>
    </Layout>
  );
}
