import { useState } from "react";
import { Layout } from "@/components/layout";
import {
  useListPlaybooks,
  useGetPlaybook,
  PlaybookWithSteps,
  ListPlaybooksDomainTag,
  ListPlaybooksStatus,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BookOpen, ChevronDown, ChevronRight, AlertCircle, RefreshCw, FileText } from "lucide-react";

function getConfidenceColor(scoreStr?: string | null) {
  if (!scoreStr) return "text-muted-foreground";
  const score = parseFloat(scoreStr);
  if (score > 0.8) return "text-emerald-600";
  if (score > 0.5) return "text-amber-600";
  return "text-red-600";
}

function parseSourceRefs(json: string): Array<{ sourceType: string; title?: string; id?: number }> {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function PlaybookDetailDialog({
  playbook,
  open,
  onClose,
}: {
  playbook: PlaybookWithSteps;
  open: boolean;
  onClose: () => void;
}) {
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());

  const toggleStep = (id: number) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const sourceRefs = parseSourceRefs(playbook.sourceRefsJson);

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-start gap-2 text-xl font-serif">
            <BookOpen className="h-5 w-5 text-primary shrink-0 mt-1" />
            {playbook.name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-[10px] font-mono uppercase">{playbook.domainTag}</Badge>
            <Badge variant="secondary" className={`text-[10px] font-mono ${getConfidenceColor(playbook.confidenceScore)}`}>
              CONF {playbook.confidenceScore ? Math.round(parseFloat(playbook.confidenceScore) * 100) + "%" : "N/A"}
            </Badge>
            <Badge variant={playbook.status === "canonical" ? "secondary" : "outline"} className="text-[10px]">
              {playbook.status}
            </Badge>
          </div>

          <p className="text-sm text-muted-foreground leading-relaxed">{playbook.summary}</p>

          {(playbook.useWhen || playbook.avoidWhen) && (
            <div className="grid grid-cols-2 gap-3">
              {playbook.useWhen && (
                <div className="bg-emerald-50 border border-emerald-100 rounded-md p-3">
                  <p className="text-[10px] font-bold uppercase text-emerald-700 mb-1">Use When</p>
                  <p className="text-xs text-emerald-900 leading-relaxed">{playbook.useWhen}</p>
                </div>
              )}
              {playbook.avoidWhen && (
                <div className="bg-red-50 border border-red-100 rounded-md p-3">
                  <p className="text-[10px] font-bold uppercase text-red-700 mb-1">Avoid When</p>
                  <p className="text-xs text-red-900 leading-relaxed">{playbook.avoidWhen}</p>
                </div>
              )}
            </div>
          )}

          {playbook.expectedOutcomes && (
            <div className="bg-blue-50 border border-blue-100 rounded-md p-3">
              <p className="text-[10px] font-bold uppercase text-blue-700 mb-1">Expected Outcomes</p>
              <p className="text-xs text-blue-900 leading-relaxed">{playbook.expectedOutcomes}</p>
            </div>
          )}

          {playbook.steps.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground border-b pb-1">
                Steps ({playbook.steps.length})
              </h3>
              <div className="space-y-1">
                {playbook.steps
                  .sort((a, b) => a.stepOrder - b.stepOrder)
                  .map((step) => {
                    const isExpanded = expandedSteps.has(step.id);
                    return (
                      <div key={step.id} className="border rounded-md overflow-hidden">
                        <button
                          onClick={() => toggleStep(step.id)}
                          className="w-full flex items-center gap-3 p-3 text-left hover:bg-muted/30 transition-colors"
                        >
                          <span className="text-[10px] font-mono font-bold text-muted-foreground w-6 shrink-0">
                            {step.stepOrder.toString().padStart(2, "0")}
                          </span>
                          <span className="flex-1 text-sm font-medium">{step.stepTitle}</span>
                          {step.stepDescription ? (
                            isExpanded ? (
                              <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                            )
                          ) : null}
                        </button>
                        {isExpanded && step.stepDescription && (
                          <div className="px-4 pb-3 pt-0 text-sm text-muted-foreground border-t bg-muted/10">
                            <p className="leading-relaxed pt-3">{step.stepDescription}</p>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {sourceRefs.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground border-b pb-1">
                Source References ({sourceRefs.length})
              </h3>
              <div className="space-y-1">
                {sourceRefs.map((ref, idx) => (
                  <div key={idx} className="flex items-center gap-2 p-2 rounded text-xs bg-muted/20">
                    <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-[10px] uppercase font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                      {ref.sourceType?.replace("_", " ") ?? "source"}
                    </span>
                    <span className="font-medium">{ref.title ?? `ID: ${ref.id}`}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function PlaybooksPage() {
  const [domainFilter, setDomainFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("canonical");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const params = {
    ...(domainFilter !== "all" ? { domain_tag: domainFilter as ListPlaybooksDomainTag } : {}),
    ...(statusFilter !== "all" ? { status: statusFilter as ListPlaybooksStatus } : {}),
  };

  const { data: playbooks, isLoading, isError, refetch } = useListPlaybooks(params);

  const { data: selectedPlaybook } = useGetPlaybook(selectedId ?? 0, {
    query: { enabled: !!selectedId, queryKey: ["playbooks", selectedId] },
  });

  return (
    <Layout>
      <div className="space-y-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Playbooks</h1>
            <p className="text-muted-foreground">Browse canonical playbooks with full step-by-step breakdowns and source references.</p>
          </div>
        </div>

        <div className="flex gap-3 items-center bg-muted/30 p-2 rounded-lg border">
          <Select value={domainFilter} onValueChange={setDomainFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All Domains" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Domains</SelectItem>
              {Object.values(ListPlaybooksDomainTag).map((tag) => (
                <SelectItem key={tag} value={tag}>{tag.toUpperCase()}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="canonical">Canonical</SelectItem>
              <SelectItem value="candidate">Candidate</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground font-mono ml-auto pr-2">
            {playbooks?.length ?? 0} playbook{(playbooks?.length ?? 0) !== 1 ? "s" : ""}
          </span>
        </div>

        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-48 rounded-lg bg-muted animate-pulse" />
            ))}
          </div>
        ) : isError ? (
          <div className="py-16 flex flex-col items-center gap-3 text-center">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <p className="font-medium text-destructive">Failed to load playbooks</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-3.5 w-3.5 mr-2" />
              Retry
            </Button>
          </div>
        ) : playbooks && playbooks.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {playbooks.map((p) => (
              <Card
                key={p.id}
                className="flex flex-col cursor-pointer hover:border-primary/40 hover:shadow-md transition-all"
                onClick={() => setSelectedId(p.id)}
              >
                <CardHeader className="pb-3">
                  <div className="flex justify-between items-start gap-2 mb-2">
                    <Badge variant="outline" className="font-mono text-[10px] uppercase">{p.domainTag}</Badge>
                    <span className={`text-[10px] font-mono font-bold ${getConfidenceColor(p.confidenceScore)}`}>
                      {p.confidenceScore ? Math.round(parseFloat(p.confidenceScore) * 100) + "% CONF" : ""}
                    </span>
                  </div>
                  <CardTitle className="text-base font-serif font-bold leading-tight">{p.name}</CardTitle>
                  <CardDescription className="line-clamp-2 text-xs mt-1">{p.summary}</CardDescription>
                </CardHeader>
                <CardContent className="mt-auto pt-0">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <ChevronRight className="h-3.5 w-3.5" />
                      Click to expand steps
                    </span>
                    <Badge variant={p.status === "canonical" ? "secondary" : "outline"} className="text-[9px]">
                      {p.status}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="py-16 text-center border rounded-lg bg-muted/10 text-muted-foreground">
            <BookOpen className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No playbooks found</p>
            <p className="text-sm mt-1">Ingest knowledge documents to extract playbooks.</p>
          </div>
        )}

        {selectedPlaybook && (
          <PlaybookDetailDialog
            playbook={selectedPlaybook}
            open={!!selectedId}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>
    </Layout>
  );
}
