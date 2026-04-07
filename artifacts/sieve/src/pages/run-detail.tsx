import { useParams, Link } from "wouter";
import { Layout } from "@/components/layout";
import { useGetRun } from "@workspace/api-client-react";
import { MemoOutputFromRun } from "@/components/memo-response";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, AlertCircle, History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

const RUN_TYPE_LABELS: Record<string, string> = {
  knowledge_answer: "Knowledge Answer",
  brand_mapping: "Brand Mapping",
  strategy_start: "Strategy Start",
};

export default function RunDetail() {
  const { id } = useParams<{ id: string }>();
  const runId = parseInt(id ?? "0", 10);

  const { data: run, isLoading, isError, error, refetch } = useGetRun(runId, {
    query: { enabled: !!runId && !isNaN(runId), queryKey: ["runs", runId] },
  });

  return (
    <Layout>
      <div className="space-y-6 max-w-4xl mx-auto">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/runs">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Run History
            </Link>
          </Button>
        </div>

        <div className="flex items-center gap-3">
          <div className="h-10 w-10 bg-primary/10 rounded flex items-center justify-center text-primary">
            <History className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Run Record #{runId.toString().padStart(5, "0")}
            </h1>
            {run && (
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="outline" className="text-[10px] uppercase font-mono">
                  {RUN_TYPE_LABELS[run.runType] ?? run.runType}
                </Badge>
                <Badge
                  variant={run.status === "done" ? "secondary" : run.status === "error" ? "destructive" : "default"}
                  className="text-[10px]"
                >
                  {run.status}
                </Badge>
                <span className="text-xs text-muted-foreground font-mono">
                  {new Date(run.createdAt).toLocaleString()}
                </span>
              </div>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="py-24 flex flex-col items-center justify-center text-muted-foreground gap-3">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="text-sm">Loading run details...</p>
          </div>
        ) : isError ? (
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="p-8 text-center">
              <AlertCircle className="h-8 w-8 text-destructive mx-auto mb-3" />
              <p className="font-medium text-destructive">Failed to load run details</p>
              <p className="text-sm text-muted-foreground mt-1 mb-4">
                {error instanceof Error ? error.message : "An unexpected error occurred."}
              </p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                Try Again
              </Button>
            </CardContent>
          </Card>
        ) : run ? (
          <MemoOutputFromRun run={run} />
        ) : (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              Run not found.
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}
