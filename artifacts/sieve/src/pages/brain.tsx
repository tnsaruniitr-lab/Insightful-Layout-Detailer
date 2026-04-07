import { useState } from "react";
import { Layout } from "@/components/layout";
import {
  useListPrinciples,
  useListRules,
  useListPlaybooks,
  useListAntiPatterns,
  Principle,
  Rule,
  AntiPattern,
  Playbook,
} from "@workspace/api-client-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BrainCircuit, BookOpen, ShieldAlert, CheckCircle, Info, AlertCircle, RefreshCw } from "lucide-react";
import { BrainObjectDetail } from "@/components/brain-object-detail";

type BrainObjectType = "principle" | "rule" | "playbook" | "anti_pattern";

interface SelectedObject {
  type: BrainObjectType;
  object: Principle | Rule | AntiPattern | Playbook;
}

function TabErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="py-12 flex flex-col items-center gap-3 text-center">
      <AlertCircle className="h-8 w-8 text-destructive" />
      <p className="font-medium text-destructive text-sm">Failed to load data</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCw className="h-3.5 w-3.5 mr-2" />
        Retry
      </Button>
    </div>
  );
}

export default function BrainExplorer() {
  const [domainFilter, setDomainFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("canonical");
  const [selected, setSelected] = useState<SelectedObject | null>(null);

  const commonParams = {
    ...(domainFilter !== "all" ? { domain_tag: domainFilter as any } : {}),
    ...(statusFilter !== "all" ? { status: statusFilter as any } : {}),
  };

  const { data: principles, isLoading: principlesLoading, isError: principlesError, refetch: refetchPrinciples } = useListPrinciples(commonParams as any);
  const { data: rules, isLoading: rulesLoading, isError: rulesError, refetch: refetchRules } = useListRules(commonParams as any);
  const { data: playbooks, isLoading: playbooksLoading, isError: playbooksError, refetch: refetchPlaybooks } = useListPlaybooks(commonParams as any);
  const { data: antipatterns, isLoading: antiPatternsLoading, isError: antiPatternsError, refetch: refetchAntiPatterns } = useListAntiPatterns(commonParams as any);

  const getConfidenceColor = (scoreStr?: string | null) => {
    if (!scoreStr) return "bg-muted text-muted-foreground";
    const score = parseFloat(scoreStr);
    if (score > 0.8) return "bg-emerald-500/10 text-emerald-600 border-emerald-200";
    if (score > 0.5) return "bg-amber-500/10 text-amber-600 border-amber-200";
    return "bg-destructive/10 text-destructive border-destructive/20";
  };

  const select = (type: BrainObjectType, object: Principle | Rule | AntiPattern | Playbook) =>
    setSelected({ type, object });

  return (
    <Layout>
      <div className="space-y-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Brain Explorer</h1>
            <p className="text-muted-foreground">Browse extracted intelligence objects across all domains.</p>
          </div>
          <div className="flex items-center gap-3">
            <Select value={domainFilter} onValueChange={setDomainFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Domain" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Domains</SelectItem>
                <SelectItem value="seo">SEO</SelectItem>
                <SelectItem value="geo">GEO</SelectItem>
                <SelectItem value="aeo">AEO</SelectItem>
                <SelectItem value="content">Content</SelectItem>
                <SelectItem value="entity">Entity</SelectItem>
                <SelectItem value="general">General</SelectItem>
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
          </div>
        </div>

        <Tabs defaultValue="principles" className="w-full">
          <TabsList className="grid w-full grid-cols-4 max-w-2xl">
            <TabsTrigger value="principles" className="flex gap-2">
              <BrainCircuit className="h-4 w-4" /> Principles
            </TabsTrigger>
            <TabsTrigger value="rules" className="flex gap-2">
              <CheckCircle className="h-4 w-4" /> Rules
            </TabsTrigger>
            <TabsTrigger value="playbooks" className="flex gap-2">
              <BookOpen className="h-4 w-4" /> Playbooks
            </TabsTrigger>
            <TabsTrigger value="antipatterns" className="flex gap-2">
              <ShieldAlert className="h-4 w-4" /> Anti-Patterns
            </TabsTrigger>
          </TabsList>

          <TabsContent value="principles" className="mt-6">
            {principlesLoading ? (
              <div className="py-12 text-center text-muted-foreground">Loading principles...</div>
            ) : principlesError ? (
              <TabErrorState onRetry={() => refetchPrinciples()} />
            ) : principles && principles.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {principles.map((p) => (
                  <Card
                    key={p.id}
                    className="flex flex-col cursor-pointer hover:shadow-md hover:border-primary/40 transition-all"
                    onClick={() => select("principle", p)}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex justify-between items-start gap-2 mb-2">
                        <Badge variant="outline" className="font-mono text-[10px]">{p.domainTag}</Badge>
                        <Badge variant="secondary" className={`text-[10px] border ${getConfidenceColor(p.confidenceScore)}`}>
                          CONF: {p.confidenceScore ? Math.round(parseFloat(p.confidenceScore) * 100) + "%" : "N/A"}
                        </Badge>
                      </div>
                      <CardTitle className="text-base font-semibold leading-tight">{p.title}</CardTitle>
                    </CardHeader>
                    <CardContent className="flex-1 text-sm text-muted-foreground">
                      <p className="line-clamp-4">{p.statement}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="py-12 text-center border rounded-lg bg-muted/10 text-muted-foreground">No principles found matching filters.</div>
            )}
          </TabsContent>

          <TabsContent value="rules" className="mt-6">
            {rulesLoading ? (
              <div className="py-12 text-center text-muted-foreground">Loading rules...</div>
            ) : rulesError ? (
              <TabErrorState onRetry={() => refetchRules()} />
            ) : rules && rules.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {rules.map((r) => (
                  <Card
                    key={r.id}
                    className="flex flex-col cursor-pointer hover:shadow-md hover:border-primary/40 transition-all"
                    onClick={() => select("rule", r)}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex justify-between items-start gap-2 mb-2">
                        <div className="flex gap-1">
                          <Badge variant="outline" className="font-mono text-[10px]">{r.domainTag}</Badge>
                          <Badge variant="secondary" className="font-mono text-[10px]">{r.ruleType}</Badge>
                        </div>
                        <Badge variant="secondary" className={`text-[10px] border ${getConfidenceColor(r.confidenceScore)}`}>
                          CONF: {r.confidenceScore ? Math.round(parseFloat(r.confidenceScore) * 100) + "%" : "N/A"}
                        </Badge>
                      </div>
                      <CardTitle className="text-base font-semibold leading-tight">{r.name}</CardTitle>
                    </CardHeader>
                    <CardContent className="flex-1 space-y-3">
                      <div className="bg-primary/5 p-3 rounded border border-primary/10 text-sm">
                        <span className="font-bold text-primary text-xs uppercase block mb-1">IF</span>
                        {r.ifCondition}
                      </div>
                      <div className="bg-muted p-3 rounded border text-sm">
                        <span className="font-bold text-foreground text-xs uppercase block mb-1">THEN</span>
                        {r.thenLogic}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="py-12 text-center border rounded-lg bg-muted/10 text-muted-foreground">No rules found matching filters.</div>
            )}
          </TabsContent>

          <TabsContent value="playbooks" className="mt-6">
            {playbooksLoading ? (
              <div className="py-12 text-center text-muted-foreground">Loading playbooks...</div>
            ) : playbooksError ? (
              <TabErrorState onRetry={() => refetchPlaybooks()} />
            ) : playbooks && playbooks.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-2">
                {playbooks.map((p) => (
                  <Card
                    key={p.id}
                    className="cursor-pointer hover:shadow-md hover:border-primary/40 transition-all"
                    onClick={() => select("playbook", p)}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex justify-between items-start gap-2 mb-2">
                        <Badge variant="outline" className="font-mono text-[10px]">{p.domainTag}</Badge>
                        <Badge variant="secondary" className={`text-[10px] border ${getConfidenceColor(p.confidenceScore)}`}>
                          CONF: {p.confidenceScore ? Math.round(parseFloat(p.confidenceScore) * 100) + "%" : "N/A"}
                        </Badge>
                      </div>
                      <CardTitle className="text-lg font-serif font-bold">{p.name}</CardTitle>
                      <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{p.summary}</p>
                    </CardHeader>
                    <CardContent>
                      <div className="flex gap-4 text-xs">
                        {p.useWhen && (
                          <div className="flex-1">
                            <span className="font-semibold text-emerald-600 block mb-1">USE WHEN:</span>
                            <span className="text-muted-foreground line-clamp-2">{p.useWhen}</span>
                          </div>
                        )}
                        {p.avoidWhen && (
                          <div className="flex-1">
                            <span className="font-semibold text-destructive block mb-1">AVOID WHEN:</span>
                            <span className="text-muted-foreground line-clamp-2">{p.avoidWhen}</span>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="py-12 text-center border rounded-lg bg-muted/10 text-muted-foreground">No playbooks found matching filters.</div>
            )}
          </TabsContent>

          <TabsContent value="antipatterns" className="mt-6">
            {antiPatternsLoading ? (
              <div className="py-12 text-center text-muted-foreground">Loading anti-patterns...</div>
            ) : antiPatternsError ? (
              <TabErrorState onRetry={() => refetchAntiPatterns()} />
            ) : antipatterns && antipatterns.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {antipatterns.map((ap) => (
                  <Card
                    key={ap.id}
                    className="flex flex-col border-destructive/30 cursor-pointer hover:shadow-md hover:border-destructive/60 transition-all"
                    onClick={() => select("anti_pattern", ap)}
                  >
                    <CardHeader className="pb-3 bg-destructive/5">
                      <div className="flex justify-between items-start gap-2 mb-2">
                        <Badge variant="outline" className="font-mono text-[10px] border-destructive/20 text-destructive">{ap.domainTag}</Badge>
                        <Badge variant="secondary" className="font-mono text-[10px] bg-destructive text-destructive-foreground">
                          {ap.riskLevel.toUpperCase()} RISK
                        </Badge>
                      </div>
                      <CardTitle className="text-base font-semibold leading-tight text-destructive">{ap.title}</CardTitle>
                    </CardHeader>
                    <CardContent className="flex-1 text-sm text-muted-foreground pt-4 space-y-4">
                      <p className="line-clamp-3">{ap.description}</p>
                      <div className="bg-muted p-2 rounded text-xs">
                        <span className="font-semibold block mb-1 text-foreground flex items-center gap-1">
                          <Info className="h-3 w-3" /> Signals
                        </span>
                        <span className="line-clamp-2">{ap.signalsJson}</span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="py-12 text-center border rounded-lg bg-muted/10 text-muted-foreground">No anti-patterns found matching filters.</div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <BrainObjectDetail
        type={selected?.type ?? "principle"}
        object={selected?.object ?? null}
        onClose={() => setSelected(null)}
      />
    </Layout>
  );
}
