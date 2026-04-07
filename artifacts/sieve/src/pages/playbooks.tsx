import { useState } from "react";
import { Layout } from "@/components/layout";
import {
  useListPlaybooks,
  useListPrinciples,
  useListRules,
  useListAntiPatterns,
  useGetPlaybook,
  PlaybookWithSteps,
  Principle,
  Rule,
  AntiPattern,
  ListPlaybooksDomainTag,
  ListPlaybooksStatus,
  ListPrinciplesStatus,
  ListPrinciplesDomainTag,
  ListRulesStatus,
  ListRulesDomainTag,
  ListAntiPatternsStatus,
  ListAntiPatternsDomainTag,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  BookOpen, ChevronDown, ChevronRight, AlertCircle, RefreshCw,
  FileText, Lightbulb, Scale, AlertTriangle,
} from "lucide-react";

function getConfidenceColor(scoreStr?: string | null) {
  if (!scoreStr) return "text-muted-foreground";
  const score = parseFloat(scoreStr);
  if (score > 0.8) return "text-emerald-600";
  if (score > 0.5) return "text-amber-600";
  return "text-red-600";
}

function parseSourceRefs(json?: string | null): Array<{ sourceType?: string; title?: string; id?: number }> {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function SourceRefsList({ json }: { json?: string | null }) {
  const refs = parseSourceRefs(json);
  if (refs.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-bold uppercase text-muted-foreground">Source Refs ({refs.length})</p>
      <div className="space-y-1">
        {refs.map((ref, idx) => (
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
  );
}

function PlaybookDetailDialog({
  playbook, open, onClose,
}: { playbook: PlaybookWithSteps; open: boolean; onClose: () => void }) {
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());

  const toggleStep = (id: number) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

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
                {[...playbook.steps].sort((a, b) => a.stepOrder - b.stepOrder).map((step) => {
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
                        {step.stepDescription && (
                          isExpanded
                            ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                            : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                        )}
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
          <SourceRefsList json={playbook.sourceRefsJson} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ObjectCard({ title, meta, body, refs, statusBadge, onClick }: {
  title: string;
  meta: React.ReactNode;
  body: string;
  refs?: string | null;
  statusBadge: React.ReactNode;
  onClick?: () => void;
}) {
  const sourceCount = parseSourceRefs(refs).length;
  return (
    <Card
      className="flex flex-col cursor-pointer hover:border-primary/40 hover:shadow-md transition-all"
      onClick={onClick}
    >
      <CardHeader className="pb-3">
        <div className="flex justify-between items-start gap-2 mb-2">
          {meta}
          {statusBadge}
        </div>
        <CardTitle className="text-base font-serif font-bold leading-tight">{title}</CardTitle>
        <CardDescription className="line-clamp-2 text-xs mt-1">{body}</CardDescription>
      </CardHeader>
      <CardContent className="mt-auto pt-0">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{sourceCount} source ref{sourceCount !== 1 ? "s" : ""}</span>
          {onClick && <ChevronRight className="h-3.5 w-3.5 opacity-50" />}
        </div>
      </CardContent>
    </Card>
  );
}

function FilterBar({
  domainFilter, setDomainFilter, statusFilter, setStatusFilter, count, label,
}: {
  domainFilter: string; setDomainFilter: (v: string) => void;
  statusFilter: string; setStatusFilter: (v: string) => void;
  count: number; label: string;
}) {
  return (
    <div className="flex gap-3 items-center bg-muted/30 p-2 rounded-lg border">
      <Select value={domainFilter} onValueChange={setDomainFilter}>
        <SelectTrigger className="w-[160px]">
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
        <SelectTrigger className="w-[150px]">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Statuses</SelectItem>
          <SelectItem value="canonical">Canonical</SelectItem>
          <SelectItem value="candidate">Candidate</SelectItem>
        </SelectContent>
      </Select>
      <span className="text-xs text-muted-foreground font-mono ml-auto pr-2">
        {count} {label}{count !== 1 ? "s" : ""}
      </span>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="py-16 text-center border rounded-lg bg-muted/10 text-muted-foreground">
      <p className="font-medium">No {label} found</p>
      <p className="text-sm mt-1">Ingest knowledge documents to extract {label.toLowerCase()}.</p>
    </div>
  );
}

function ErrorState({ label, onRetry }: { label: string; onRetry: () => void }) {
  return (
    <div className="py-16 flex flex-col items-center gap-3 text-center">
      <AlertCircle className="h-8 w-8 text-destructive" />
      <p className="font-medium text-destructive">Failed to load {label}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCw className="h-3.5 w-3.5 mr-2" />Retry
      </Button>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div key={i} className="h-44 rounded-lg bg-muted animate-pulse" />
      ))}
    </div>
  );
}

function PlaybooksTab() {
  const [domain, setDomain] = useState("all");
  const [status, setStatus] = useState("canonical");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const params = {
    ...(domain !== "all" ? { domain_tag: domain as ListPlaybooksDomainTag } : {}),
    ...(status !== "all" ? { status: status as ListPlaybooksStatus } : {}),
  };

  const { data, isLoading, isError, refetch } = useListPlaybooks(params);
  const { data: selected } = useGetPlaybook(selectedId ?? 0, {
    query: { enabled: !!selectedId, queryKey: ["playbooks", selectedId] },
  });

  return (
    <div className="space-y-4">
      <FilterBar domainFilter={domain} setDomainFilter={setDomain} statusFilter={status} setStatusFilter={setStatus} count={data?.length ?? 0} label="Playbook" />
      {isLoading ? <SkeletonGrid /> : isError ? <ErrorState label="Playbooks" onRetry={refetch} /> : !data?.length ? <EmptyState label="Playbooks" /> : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {data.map((p) => (
            <ObjectCard
              key={p.id}
              title={p.name}
              body={p.summary}
              refs={p.sourceRefsJson}
              statusBadge={<Badge variant={p.status === "canonical" ? "secondary" : "outline"} className="text-[9px]">{p.status}</Badge>}
              meta={<div className="flex gap-1.5 flex-wrap"><Badge variant="outline" className="font-mono text-[10px] uppercase">{p.domainTag}</Badge><span className={`text-[10px] font-mono font-bold ${getConfidenceColor(p.confidenceScore)}`}>{p.confidenceScore ? Math.round(parseFloat(p.confidenceScore) * 100) + "% CONF" : ""}</span></div>}
              onClick={() => setSelectedId(p.id)}
            />
          ))}
        </div>
      )}
      {selected && <PlaybookDetailDialog playbook={selected} open={!!selectedId} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

function PrinciplesTab() {
  const [domain, setDomain] = useState("all");
  const [status, setStatus] = useState("canonical");

  const { data, isLoading, isError, refetch } = useListPrinciples({
    ...(domain !== "all" ? { domain_tag: domain as ListPrinciplesDomainTag } : {}),
    ...(status !== "all" ? { status: status as ListPrinciplesStatus } : {}),
  });

  return (
    <div className="space-y-4">
      <FilterBar domainFilter={domain} setDomainFilter={setDomain} statusFilter={status} setStatusFilter={setStatus} count={data?.length ?? 0} label="Principle" />
      {isLoading ? <SkeletonGrid /> : isError ? <ErrorState label="Principles" onRetry={refetch} /> : !data?.length ? <EmptyState label="Principles" /> : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {data.map((p: Principle) => (
            <ObjectCard
              key={p.id}
              title={p.title}
              body={p.statement}
              refs={p.sourceRefsJson}
              statusBadge={<Badge variant={p.status === "canonical" ? "secondary" : "outline"} className="text-[9px]">{p.status}</Badge>}
              meta={<div className="flex gap-1.5 flex-wrap"><Badge variant="outline" className="font-mono text-[10px] uppercase">{p.domainTag}</Badge>{p.confidenceScore && <span className={`text-[10px] font-mono font-bold ${getConfidenceColor(p.confidenceScore)}`}>{Math.round(parseFloat(p.confidenceScore) * 100)}% CONF</span>}</div>}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RulesTab() {
  const [domain, setDomain] = useState("all");
  const [status, setStatus] = useState("canonical");

  const { data, isLoading, isError, refetch } = useListRules({
    ...(domain !== "all" ? { domain_tag: domain as ListRulesDomainTag } : {}),
    ...(status !== "all" ? { status: status as ListRulesStatus } : {}),
  });

  return (
    <div className="space-y-4">
      <FilterBar domainFilter={domain} setDomainFilter={setDomain} statusFilter={status} setStatusFilter={setStatus} count={data?.length ?? 0} label="Rule" />
      {isLoading ? <SkeletonGrid /> : isError ? <ErrorState label="Rules" onRetry={refetch} /> : !data?.length ? <EmptyState label="Rules" /> : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {data.map((r: Rule) => (
            <ObjectCard
              key={r.id}
              title={r.name}
              body={`IF: ${r.ifCondition}\nTHEN: ${r.thenLogic}`}
              refs={r.sourceRefsJson}
              statusBadge={<Badge variant={r.status === "canonical" ? "secondary" : "outline"} className="text-[9px]">{r.status}</Badge>}
              meta={<div className="flex gap-1.5 flex-wrap"><Badge variant="outline" className="font-mono text-[10px] uppercase">{r.domainTag}</Badge><Badge variant="outline" className="text-[10px]">{r.ruleType}</Badge></div>}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AntiPatternsTab() {
  const [domain, setDomain] = useState("all");
  const [status, setStatus] = useState("canonical");

  const { data, isLoading, isError, refetch } = useListAntiPatterns({
    ...(domain !== "all" ? { domain_tag: domain as ListAntiPatternsDomainTag } : {}),
    ...(status !== "all" ? { status: status as ListAntiPatternsStatus } : {}),
  });

  return (
    <div className="space-y-4">
      <FilterBar domainFilter={domain} setDomainFilter={setDomain} statusFilter={status} setStatusFilter={setStatus} count={data?.length ?? 0} label="Anti-Pattern" />
      {isLoading ? <SkeletonGrid /> : isError ? <ErrorState label="Anti-Patterns" onRetry={refetch} /> : !data?.length ? <EmptyState label="Anti-Patterns" /> : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {data.map((a: AntiPattern) => (
            <ObjectCard
              key={a.id}
              title={a.title}
              body={a.description}
              refs={a.signalsJson}
              statusBadge={<div className="flex gap-1"><Badge variant={a.riskLevel === "high" ? "destructive" : "outline"} className="text-[9px]">{a.riskLevel} risk</Badge><Badge variant={a.status === "canonical" ? "secondary" : "outline"} className="text-[9px]">{a.status}</Badge></div>}
              meta={<Badge variant="outline" className="font-mono text-[10px] uppercase">{a.domainTag}</Badge>}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function PlaybooksPage() {
  return (
    <Layout>
      <div className="space-y-6 max-w-6xl mx-auto">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Playbooks & Brain Objects</h1>
          <p className="text-muted-foreground">Browse canonical and candidate intelligence objects extracted from knowledge documents.</p>
        </div>

        <Tabs defaultValue="playbooks">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="playbooks" className="flex items-center gap-1.5">
              <BookOpen className="h-3.5 w-3.5" />Playbooks
            </TabsTrigger>
            <TabsTrigger value="principles" className="flex items-center gap-1.5">
              <Lightbulb className="h-3.5 w-3.5" />Principles
            </TabsTrigger>
            <TabsTrigger value="rules" className="flex items-center gap-1.5">
              <Scale className="h-3.5 w-3.5" />Rules
            </TabsTrigger>
            <TabsTrigger value="anti-patterns" className="flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" />Anti-Patterns
            </TabsTrigger>
          </TabsList>
          <TabsContent value="playbooks" className="mt-4"><PlaybooksTab /></TabsContent>
          <TabsContent value="principles" className="mt-4"><PrinciplesTab /></TabsContent>
          <TabsContent value="rules" className="mt-4"><RulesTab /></TabsContent>
          <TabsContent value="anti-patterns" className="mt-4"><AntiPatternsTab /></TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
