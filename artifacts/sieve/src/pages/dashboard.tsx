import { Layout } from "@/components/layout";
import { useBrandContext } from "@/hooks/use-brand-context";
import { useGetBrand, useListRuns, useListDocuments } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Activity, Database, BrainCircuit, History, ArrowRight, MessageSquare, MapPin, Target, Upload } from "lucide-react";
import { Link } from "wouter";

export default function Dashboard() {
  const { activeBrandId } = useBrandContext();
  
  const { data: brand, isLoading: brandLoading } = useGetBrand(activeBrandId || 0, {
    query: { enabled: !!activeBrandId }
  });

  const { data: runs, isLoading: runsLoading } = useListRuns(
    { limit: 5 },
    { query: { enabled: true } }
  );

  const { data: docs, isLoading: docsLoading } = useListDocuments(
    { status: "done" },
    { query: { enabled: true } }
  );

  return (
    <Layout>
      <div className="space-y-8 max-w-6xl mx-auto">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight">Intelligence Dashboard</h1>
          <p className="text-muted-foreground">
            Overview of knowledge processing and analytical output for {brand?.name || "your active brand"}.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Brand</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{brand?.name || "None"}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {brandLoading ? "Loading..." : "Currently analyzing"}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Processed Documents</CardTitle>
              <Database className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{docs?.length || 0}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {docsLoading ? "Loading..." : "Canonical sources indexed"}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Recent Runs</CardTitle>
              <History className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{runs?.length || 0}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {runsLoading ? "Loading..." : "Analytical jobs completed"}
              </p>
            </CardContent>
          </Card>
          <Card className="bg-primary text-primary-foreground border-primary">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-primary-foreground/80">Brain Status</CardTitle>
              <BrainCircuit className="h-4 w-4 text-primary-foreground/80" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">Online</div>
              <p className="text-xs text-primary-foreground/80 mt-1">
                Ready for queries
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card className="col-span-1">
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
              <CardDescription>Common analytical workflows</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Link href="/ask" className="flex items-center p-4 border rounded-lg hover:bg-muted/50 transition-colors group cursor-pointer">
                <div className="h-10 w-10 rounded bg-primary/10 flex items-center justify-center text-primary mr-4 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  <MessageSquare className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <h4 className="text-sm font-semibold">Ask the Brain</h4>
                  <p className="text-xs text-muted-foreground">Query the knowledge base</p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
              </Link>
              
              <Link href="/knowledge" className="flex items-center p-4 border rounded-lg hover:bg-muted/50 transition-colors group cursor-pointer">
                <div className="h-10 w-10 rounded bg-primary/10 flex items-center justify-center text-primary mr-4 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  <Database className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <h4 className="text-sm font-semibold">Ingest Knowledge</h4>
                  <p className="text-xs text-muted-foreground">Upload playbooks and rules</p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
              </Link>
            </CardContent>
          </Card>

          <Card className="col-span-1">
            <CardHeader>
              <CardTitle>Recent Runs</CardTitle>
              <CardDescription>Latest outputs from the intelligence engine</CardDescription>
            </CardHeader>
            <CardContent>
              {runsLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="flex items-center gap-4">
                      <div className="w-8 h-8 rounded-full bg-muted animate-pulse" />
                      <div className="space-y-2 flex-1">
                        <div className="h-4 bg-muted rounded w-1/3 animate-pulse" />
                        <div className="h-3 bg-muted rounded w-1/4 animate-pulse" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : runs && runs.length > 0 ? (
                <div className="space-y-4">
                  {runs.map(run => (
                    <div key={run.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div>
                        <div className="text-sm font-medium">{run.runType.replace("_", " ")}</div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(run.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                      <div className="px-2 py-1 bg-muted rounded text-xs font-mono">
                        {run.status}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  No runs recorded yet.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
}
