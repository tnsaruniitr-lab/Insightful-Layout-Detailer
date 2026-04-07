import { Layout } from "@/components/layout";
import { useBrandContext } from "@/hooks/use-brand-context";
import {
  useGetBrand,
  useListRuns,
  useListDocuments,
  useListPrinciples,
  useListPlaybooks,
  useListRules,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, Database, Brain, History, ArrowRight, MessageSquare, Target, BookOpen, CheckCircle } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function Dashboard() {
  const { activeBrandId } = useBrandContext();

  const { data: brand, isLoading: brandLoading } = useGetBrand(activeBrandId || 0, {
    query: { enabled: !!activeBrandId, queryKey: ["brands", activeBrandId] },
  });

  const { data: runs, isLoading: runsLoading } = useListRuns({ limit: 5 });
  const { data: docs } = useListDocuments({ status: "done" });
  const { data: principles } = useListPrinciples({ status: "canonical" });
  const { data: playbooks } = useListPlaybooks({ status: "canonical" });
  const { data: rules } = useListRules({ status: "canonical" });

  const RUN_TYPE_LABELS: Record<string, string> = {
    knowledge_answer: "Knowledge Answer",
    brand_mapping: "Brand Mapping",
    strategy_start: "Strategy Start",
  };

  return (
    <Layout>
      <div className="space-y-8 max-w-6xl mx-auto">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight">Intelligence Dashboard</h1>
          <p className="text-muted-foreground">
            {brandLoading
              ? "Loading brand context..."
              : brand
              ? `Overview of knowledge processing and analytical output for ${brand.name}.`
              : "Overview of the Sieve intelligence engine."}
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Brand</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold truncate">{brand?.name || "None"}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {brandLoading ? "Loading..." : brand ? "Currently analyzing" : "No brand configured"}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Processed Documents</CardTitle>
              <Database className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{docs?.length ?? 0}</div>
              <p className="text-xs text-muted-foreground mt-1">Canonical sources indexed</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Recent Runs</CardTitle>
              <History className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{runs?.length ?? 0}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {runsLoading ? "Loading..." : "Latest 5 shown"}
              </p>
            </CardContent>
          </Card>

          <Card className="bg-primary text-primary-foreground border-primary">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-primary-foreground/80">Brain Status</CardTitle>
              <Brain className="h-4 w-4 text-primary-foreground/80" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">Online</div>
              <p className="text-xs text-primary-foreground/80 mt-1">Ready for queries</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Canonical Principles</CardTitle>
              <Brain className="h-4 w-4 text-violet-500" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{principles?.length ?? 0}</div>
              <p className="text-xs text-muted-foreground mt-1">Core truths indexed</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Canonical Playbooks</CardTitle>
              <BookOpen className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{playbooks?.length ?? 0}</div>
              <p className="text-xs text-muted-foreground mt-1">Repeatable procedures</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Canonical Rules</CardTitle>
              <CheckCircle className="h-4 w-4 text-emerald-500" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{rules?.length ?? 0}</div>
              <p className="text-xs text-muted-foreground mt-1">IF/THEN logic indexed</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Quick Actions</h2>
              <p className="text-sm text-muted-foreground">Common analytical workflows</p>
            </div>

            <Card>
              <CardContent className="p-0 divide-y">
                <Link href="/ask" className="flex items-center p-4 hover:bg-muted/50 transition-colors group cursor-pointer">
                  <div className="h-9 w-9 rounded bg-primary/10 flex items-center justify-center text-primary mr-3 group-hover:bg-primary group-hover:text-primary-foreground transition-colors shrink-0">
                    <MessageSquare className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-semibold">Ask the Brain</h4>
                    <p className="text-xs text-muted-foreground">Query the knowledge base</p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors ml-2" />
                </Link>

                <Link href="/brain" className="flex items-center p-4 hover:bg-muted/50 transition-colors group cursor-pointer">
                  <div className="h-9 w-9 rounded bg-violet-100 flex items-center justify-center text-violet-600 mr-3 group-hover:bg-violet-600 group-hover:text-white transition-colors shrink-0">
                    <Brain className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-semibold">Brain Explorer</h4>
                    <p className="text-xs text-muted-foreground">Browse principles, rules, playbooks</p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors ml-2" />
                </Link>

                <Link href="/knowledge" className="flex items-center p-4 hover:bg-muted/50 transition-colors group cursor-pointer">
                  <div className="h-9 w-9 rounded bg-emerald-100 flex items-center justify-center text-emerald-600 mr-3 group-hover:bg-emerald-600 group-hover:text-white transition-colors shrink-0">
                    <Database className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-semibold">Ingest Knowledge</h4>
                    <p className="text-xs text-muted-foreground">Upload playbooks and rules</p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors ml-2" />
                </Link>
              </CardContent>
            </Card>

            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="h-9 w-9 rounded bg-primary/10 flex items-center justify-center text-primary shrink-0">
                    <Target className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-semibold">Where should this brand start?</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Get a prioritized action plan based on all canonical playbooks and brand context.
                    </p>
                    <Button size="sm" className="mt-3" asChild>
                      <Link href="/strategy">Generate Action Plan</Link>
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Recent Runs</h2>
              <p className="text-sm text-muted-foreground">Latest outputs from the intelligence engine</p>
            </div>
            <Card>
              <CardContent className="p-0">
                {runsLoading ? (
                  <div className="space-y-0 divide-y">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="p-4 flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-muted animate-pulse shrink-0" />
                        <div className="space-y-2 flex-1">
                          <div className="h-3 bg-muted rounded w-1/2 animate-pulse" />
                          <div className="h-2.5 bg-muted rounded w-1/3 animate-pulse" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : runs && runs.length > 0 ? (
                  <div className="divide-y">
                    {runs.map((run) => (
                      <Link
                        key={run.id}
                        href={`/runs/${run.id}`}
                        className="p-3 flex items-center justify-between hover:bg-muted/30 transition-colors cursor-pointer group"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                            <span className="text-xs font-medium">{RUN_TYPE_LABELS[run.runType] ?? run.runType}</span>
                            <Badge
                              variant={run.status === "done" ? "secondary" : "default"}
                              className="text-[10px] font-mono"
                            >
                              {run.status}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground truncate max-w-[260px]">
                            {run.query || "Strategy generation"}
                          </p>
                          <p className="text-[10px] text-muted-foreground/70 font-mono mt-0.5">
                            {new Date(run.createdAt).toLocaleString()}
                          </p>
                        </div>
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity ml-2 shrink-0" />
                      </Link>
                    ))}
                    <div className="p-3 text-center">
                      <Link href="/runs" className="text-xs text-primary hover:underline font-medium">
                        View all runs
                      </Link>
                    </div>
                  </div>
                ) : (
                  <div className="p-8 text-center text-muted-foreground text-sm">
                    No runs recorded yet.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </Layout>
  );
}
