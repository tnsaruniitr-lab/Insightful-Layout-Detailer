import { useState } from "react";
import { Layout } from "@/components/layout";
import { useBrandContext } from "@/hooks/use-brand-context";
import { useListRuns, useGetRun, ListRunsRunType } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { History, Search, ArrowRight, ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { MemoResponseView } from "@/components/memo-response";

export default function RunsHistory() {
  const { activeBrandId } = useBrandContext();
  const [runTypeFilter, setRunTypeFilter] = useState<string>("all");
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);

  const listParams = {
    ...(activeBrandId ? { brand_id: activeBrandId } : {}),
    ...(runTypeFilter !== "all" ? { run_type: runTypeFilter as ListRunsRunType } : {}),
    limit: 50
  };

  const { data: runs, isLoading: runsLoading } = useListRuns(listParams, { query: { enabled: true } });
  
  const { data: selectedRun, isLoading: runDetailsLoading } = useGetRun(
    selectedRunId || 0,
    { query: { enabled: !!selectedRunId } }
  );

  // Convert MappingRunDetail back to MemoResponse shape for viewing
  const formattedMemo = selectedRun ? {
    id: selectedRun.id,
    runType: selectedRun.runType as any,
    query: selectedRun.query,
    rationale_summary: selectedRun.rationale_summary,
    missing_data: selectedRun.missing_data,
    status: selectedRun.status,
    createdAt: selectedRun.createdAt,
    // Note: in a real app we'd parse outputJson into sections, but we do best effort here
    sections: (() => {
      try {
        return JSON.parse(selectedRun.outputJson);
      } catch {
        return {
          knownPrinciples: "Data parsing error",
          uncertainty: "",
          missingData: ""
        };
      }
    })(),
    source_refs: selectedRun.sources.map(s => ({
      sourceType: s.sourceType as any,
      sourceId: s.sourceId,
      title: `Source ${s.sourceId}`
    }))
  } : null;

  return (
    <Layout>
      <div className="space-y-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Run History</h1>
            <p className="text-muted-foreground">Audit log of all intelligence engine analytical executions.</p>
          </div>
        </div>

        <div className="flex gap-4 items-center bg-muted/30 p-2 rounded-lg border">
          <div className="flex-1">
            <Select value={runTypeFilter} onValueChange={setRunTypeFilter}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Filter by Job Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Run Types</SelectItem>
                <SelectItem value="knowledge_answer">Knowledge Answer</SelectItem>
                <SelectItem value="brand_mapping">Brand Mapping</SelectItem>
                <SelectItem value="strategy_start">Strategy Start</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            {runsLoading ? (
              <div className="p-12 text-center text-muted-foreground">Loading runs...</div>
            ) : runs && runs.length > 0 ? (
              <div className="divide-y">
                {runs.map((run) => (
                  <div 
                    key={run.id} 
                    className="p-4 flex items-center justify-between hover:bg-muted/20 transition-colors cursor-pointer group"
                    onClick={() => setSelectedRunId(run.id)}
                  >
                    <div className="flex items-start gap-4">
                      <div className="mt-1 h-10 w-10 bg-primary/10 rounded flex items-center justify-center text-primary">
                        <History className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-mono text-xs text-muted-foreground">#{run.id.toString().padStart(5, '0')}</span>
                          <Badge variant="outline" className="text-[10px] uppercase">{run.runType.replace("_", " ")}</Badge>
                          <Badge variant={run.status === "done" ? "secondary" : "default"} className="text-[10px]">{run.status}</Badge>
                        </div>
                        <h4 className="font-semibold text-sm line-clamp-1">{run.query || "Automated Strategy Generation"}</h4>
                        <div className="text-xs text-muted-foreground mt-1">
                          {new Date(run.createdAt).toLocaleString()}
                        </div>
                      </div>
                    </div>
                    <div className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity pr-4">
                      <ArrowRight className="h-5 w-5" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-12 text-center text-muted-foreground flex flex-col items-center justify-center">
                <Search className="h-12 w-12 text-muted-foreground/30 mb-4" />
                <h3 className="text-lg font-medium text-foreground">No runs found</h3>
                <p>Execute queries or generate strategies to populate history.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!selectedRunId} onOpenChange={(open) => !open && setSelectedRunId(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader className="mb-4">
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5 text-primary" />
              Run Record #{selectedRunId?.toString().padStart(5, '0')}
            </DialogTitle>
            <DialogDescription>
              Historical execution output from the intelligence engine.
            </DialogDescription>
          </DialogHeader>
          
          {runDetailsLoading ? (
            <div className="py-12 text-center">Loading run details...</div>
          ) : formattedMemo ? (
            <MemoResponseView memo={formattedMemo as any} />
          ) : (
            <div className="py-12 text-center text-destructive">Failed to load run details.</div>
          )}
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
