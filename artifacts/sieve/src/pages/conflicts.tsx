import { useState } from "react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle, Trash2, RefreshCw, ShieldAlert } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

interface ContestedItem {
  table: string;
  id: number;
  title: string;
  domainTag: string | null;
  status: string | null;
}

interface ConflictsResponse {
  total: number;
  contested: ContestedItem[];
}

const TABLE_LABELS: Record<string, string> = {
  principles: "Principle",
  rules: "Rule",
  playbooks: "Playbook",
  anti_patterns: "Anti-Pattern",
};

const TABLE_COLORS: Record<string, string> = {
  principles: "bg-blue-100 text-blue-800",
  rules: "bg-purple-100 text-purple-800",
  playbooks: "bg-emerald-100 text-emerald-800",
  anti_patterns: "bg-red-100 text-red-800",
};

export default function ConflictsPage() {
  const queryClient = useQueryClient();
  const [resolving, setResolving] = useState<Record<string, boolean>>({});

  const { data, isLoading, isError, refetch } = useQuery<ConflictsResponse>({
    queryKey: ["conflicts"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/brain/conflicts`);
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<ConflictsResponse>;
    },
  });

  const resolveMutation = useMutation({
    mutationFn: async ({ id, table, action }: { id: number; table: string; action: "keep" | "discard" }) => {
      const res = await fetch(`${API_BASE}/api/brain/conflicts/${id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table, action }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conflicts"] });
    },
  });

  async function handleResolve(item: ContestedItem, action: "keep" | "discard") {
    const key = `${item.table}-${item.id}`;
    setResolving((prev) => ({ ...prev, [key]: true }));
    try {
      await resolveMutation.mutateAsync({ id: item.id, table: item.table, action });
    } finally {
      setResolving((prev) => ({ ...prev, [key]: false }));
    }
  }

  return (
    <Layout>
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <ShieldAlert className="h-6 w-6 text-amber-500" />
              Conflict Review
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Brain objects flagged as contested due to semantic contradictions. Review and resolve each conflict.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {isLoading && (
          <div className="text-center py-16 text-muted-foreground">Loading conflicts…</div>
        )}

        {isError && (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="pt-6 text-red-700">Failed to load conflicts.</CardContent>
          </Card>
        )}

        {data && data.total === 0 && (
          <Card>
            <CardContent className="pt-10 pb-10 text-center">
              <CheckCircle className="h-10 w-10 text-green-500 mx-auto mb-3" />
              <p className="font-semibold text-lg">No contested objects</p>
              <p className="text-muted-foreground text-sm mt-1">
                All brain objects are consistent. Conflicts are detected automatically during ingestion.
              </p>
            </CardContent>
          </Card>
        )}

        {data && data.total > 0 && (
          <>
            <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{data.total} contested object{data.total !== 1 ? "s" : ""} require review. Contested objects are excluded from scoring until resolved.</span>
            </div>

            <div className="space-y-3">
              {data.contested.map((item) => {
                const key = `${item.table}-${item.id}`;
                const isResolving = resolving[key];
                return (
                  <Card key={key} className="border-amber-200">
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${TABLE_COLORS[item.table] ?? "bg-gray-100 text-gray-700"}`}>
                            {TABLE_LABELS[item.table] ?? item.table}
                          </span>
                          {item.domainTag && (
                            <Badge variant="secondary" className="text-xs font-mono uppercase">{item.domainTag}</Badge>
                          )}
                          {item.status && (
                            <Badge variant="outline" className="text-xs">{item.status}</Badge>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0">ID {item.id}</span>
                      </div>
                      <CardTitle className="text-base font-semibold mt-1">{item.title || "(untitled)"}</CardTitle>
                      <CardDescription className="text-xs text-amber-600 flex items-center gap-1 mt-0.5">
                        <AlertTriangle className="h-3 w-3" />
                        Semantically contradicts another brain object in the same domain
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="flex gap-2 flex-wrap">
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-green-700 border-green-300 hover:bg-green-50"
                          disabled={isResolving}
                          onClick={() => handleResolve(item, "keep")}
                        >
                          <CheckCircle className="h-4 w-4 mr-1" />
                          Keep &amp; Clear Flag
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-red-700 border-red-300 hover:bg-red-50"
                          disabled={isResolving}
                          onClick={() => handleResolve(item, "discard")}
                        >
                          <Trash2 className="h-4 w-4 mr-1" />
                          Discard Object
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
