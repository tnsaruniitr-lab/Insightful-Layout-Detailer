import { useState } from "react";
import { Layout } from "@/components/layout";
import { useBrandContext } from "@/hooks/use-brand-context";
import { useGetBrandStrategy, MemoResponse } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Settings2, Loader2, ArrowRightCircle } from "lucide-react";
import { MemoResponseView } from "@/components/memo-response";
import { useToast } from "@/hooks/use-toast";

export default function StrategyOutput() {
  const { activeBrandId } = useBrandContext();
  const { toast } = useToast();
  
  const [response, setResponse] = useState<MemoResponse | null>(null);

  const getStrategy = useGetBrandStrategy();

  const handleGenerate = async () => {
    if (!activeBrandId) return;

    try {
      const result = await getStrategy.mutateAsync({
        data: {
          brandId: activeBrandId,
        }
      });
      setResponse(result);
    } catch (error) {
      toast({ title: "Failed to generate strategy output", variant: "destructive" });
    }
  };

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
            <CardContent className="p-6 text-center text-destructive">
              Please select or create an active brand from the Brand Profile page to generate strategy.
            </CardContent>
          </Card>
        ) : !response ? (
          <Card className="border-2 border-primary/20 bg-muted/10 shadow-sm overflow-hidden">
            <div className="h-1 bg-gradient-to-r from-primary/40 via-primary to-primary/40" />
            <CardContent className="p-12 text-center flex flex-col items-center justify-center min-h-[300px]">
              <h3 className="text-xl font-serif font-bold mb-4">Ready for Synthesis</h3>
              <p className="text-muted-foreground max-w-md mx-auto mb-8 text-sm">
                The engine will evaluate your active brand against all canonical playbooks, rules, and principles to determine the highest-leverage starting points.
              </p>
              <Button 
                onClick={handleGenerate} 
                size="lg" 
                className="px-8 font-semibold h-14 text-lg w-full max-w-sm shadow-md"
                disabled={getStrategy.isPending}
              >
                {getStrategy.isPending ? (
                  <>
                    <Loader2 className="mr-3 h-5 w-5 animate-spin" /> Synthesizing Strategy...
                  </>
                ) : (
                  <>
                    Generate Action Plan <ArrowRightCircle className="ml-3 h-5 w-5" />
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => setResponse(null)}>
                Clear Output
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
