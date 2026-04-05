import { useState } from "react";
import { Layout } from "@/components/layout";
import { useBrandContext } from "@/hooks/use-brand-context";
import { useAskBrain, MemoResponse } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { BrainCircuit, Loader2, Search } from "lucide-react";
import { MemoResponseView } from "@/components/memo-response";
import { useToast } from "@/hooks/use-toast";

export default function AskBrain() {
  const { activeBrandId } = useBrandContext();
  const { toast } = useToast();
  
  const [question, setQuestion] = useState("");
  const [useContext, setUseContext] = useState(true);
  const [response, setResponse] = useState<MemoResponse | null>(null);

  const askBrain = useAskBrain();

  const handleAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;

    try {
      const result = await askBrain.mutateAsync({
        data: {
          question,
          brandId: useContext ? activeBrandId || undefined : undefined,
          useBrandContext: useContext
        }
      });
      setResponse(result);
    } catch (error) {
      toast({ title: "Failed to process query", variant: "destructive" });
    }
  };

  return (
    <Layout>
      <div className="space-y-8 max-w-4xl mx-auto">
        <div className="text-center space-y-3 py-6">
          <div className="mx-auto h-16 w-16 bg-primary/10 flex items-center justify-center rounded-2xl mb-4">
            <BrainCircuit className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Ask the Brain</h1>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Query the compiled knowledge base. The intelligence engine will synthesize principles, rules, and playbooks to answer your strategic questions.
          </p>
        </div>

        <Card className="border-2 border-primary/20 shadow-md">
          <CardContent className="p-6">
            <form onSubmit={handleAsk} className="space-y-4">
              <div className="relative">
                <Search className="absolute left-4 top-4 h-5 w-5 text-muted-foreground" />
                <Input 
                  className="pl-12 h-14 text-lg border-muted-foreground/20 focus-visible:ring-primary shadow-inner"
                  placeholder="e.g. What are the canonical principles for programmatic SEO?"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  disabled={askBrain.isPending}
                />
              </div>
              <div className="flex items-center justify-between px-2">
                <div className="flex items-center space-x-2">
                  <Switch 
                    id="context-mode" 
                    checked={useContext} 
                    onCheckedChange={setUseContext}
                    disabled={!activeBrandId || askBrain.isPending}
                  />
                  <Label htmlFor="context-mode" className="text-sm font-medium cursor-pointer">
                    Apply active brand context
                  </Label>
                </div>
                <Button type="submit" size="lg" className="px-8 font-semibold" disabled={!question.trim() || askBrain.isPending}>
                  {askBrain.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Analyzing
                    </>
                  ) : (
                    "Submit Query"
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {response && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 pt-4">
            <MemoResponseView memo={response} />
          </div>
        )}
      </div>
    </Layout>
  );
}
