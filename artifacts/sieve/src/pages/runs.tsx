import { useState } from "react";
import { Layout } from "@/components/layout";
import { useListRuns, ListRunsRunType } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { History, AlertCircle, RefreshCw, Search, ArrowRight } from "lucide-react";
import { Link, useLocation } from "wouter";

const RUN_TYPE_LABELS: Record<string, string> = {
  knowledge_answer: "Knowledge Answer",
  brand_mapping: "Brand Mapping",
  strategy_start: "Strategy Start",
};

export default function RunsHistory() {
  const [, setLocation] = useLocation();
  const [runTypeFilter, setRunTypeFilter] = useState<string>("all");

  const listParams = {
    ...(runTypeFilter !== "all" ? { run_type: runTypeFilter as ListRunsRunType } : {}),
    limit: 100,
  };

  const { data: runs, isLoading: runsLoading, isError, refetch } = useListRuns(listParams);

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
          <span className="text-xs text-muted-foreground font-mono ml-auto pr-2">
            {runs?.length ?? 0} execution{(runs?.length ?? 0) !== 1 ? "s" : ""}
          </span>
        </div>

        {isError ? (
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="p-8 flex flex-col items-center gap-3 text-center">
              <AlertCircle className="h-8 w-8 text-destructive" />
              <p className="font-medium text-destructive">Failed to load run history</p>
              <p className="text-sm text-muted-foreground">Check API connectivity and try again.</p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                <RefreshCw className="h-3.5 w-3.5 mr-2" />
                Try Again
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              {runsLoading ? (
                <div className="p-12 text-center text-muted-foreground flex flex-col items-center gap-3">
                  <History className="h-8 w-8 opacity-30 animate-pulse" />
                  Loading runs...
                </div>
              ) : runs && runs.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-20">ID</TableHead>
                      <TableHead className="w-40">Type</TableHead>
                      <TableHead>Query / Description</TableHead>
                      <TableHead className="w-24">Status</TableHead>
                      <TableHead className="w-40">Timestamp</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.map((run) => (
                      <TableRow
                        key={run.id}
                        className="cursor-pointer hover:bg-muted/30 transition-colors group"
                        onClick={() => setLocation(`/runs/${run.id}`)}
                      >
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          #{run.id.toString().padStart(5, "0")}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px] uppercase font-mono">
                            {RUN_TYPE_LABELS[run.runType] ?? run.runType}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-[300px]">
                          <span className="text-sm truncate block" title={run.query ?? undefined}>
                            {run.query || <span className="text-muted-foreground italic">Strategy generation</span>}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={run.status === "done" ? "secondary" : run.status === "error" ? "destructive" : "default"}
                            className="text-[10px]"
                          >
                            {run.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground font-mono">
                          {new Date(run.createdAt).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="p-16 text-center text-muted-foreground flex flex-col items-center justify-center">
                  <Search className="h-12 w-12 text-muted-foreground/30 mb-4" />
                  <h3 className="text-lg font-semibold text-foreground">No runs recorded yet</h3>
                  <p className="text-sm mt-1">Execute queries on the Ask page or generate a strategy to populate history.</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}
