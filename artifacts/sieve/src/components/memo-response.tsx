import { useState } from "react";
import { MemoResponse, MemoScoringTrace, ScoringTraceCandidateSummary, MappingRunDetail, SourceRef, SourceRefSourceType } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { FileText, AlertTriangle, BookOpen, Brain, HelpCircle, Database, ChevronDown, ChevronRight, Zap, Clock, Filter, Layers } from "lucide-react";

interface MemoResponseViewProps {
  memo: MemoResponse;
}

function SourcesPanel({ sourceRefs }: { sourceRefs: SourceRef[] }) {
  const getSourceIcon = (type: string) => {
    switch (type) {
      case "principle": return <Brain className="h-3.5 w-3.5 text-violet-500" />;
      case "playbook": return <BookOpen className="h-3.5 w-3.5 text-blue-500" />;
      case "rule": return <HelpCircle className="h-3.5 w-3.5 text-amber-500" />;
      case "anti_pattern": return <AlertTriangle className="h-3.5 w-3.5 text-red-500" />;
      default: return <FileText className="h-3.5 w-3.5 text-muted-foreground" />;
    }
  };

  const getSourceBadgeColor = (type: string) => {
    switch (type) {
      case "principle": return "bg-violet-50 text-violet-700 border-violet-200";
      case "playbook": return "bg-blue-50 text-blue-700 border-blue-200";
      case "rule": return "bg-amber-50 text-amber-700 border-amber-200";
      case "anti_pattern": return "bg-red-50 text-red-700 border-red-200";
      default: return "bg-muted text-muted-foreground border-border";
    }
  };

  return (
    <div className="space-y-3 pt-2">
      <div className="flex items-center gap-2">
        <Database className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Sources & Citations ({sourceRefs.length})
        </h3>
      </div>
      {sourceRefs.length === 0 ? (
        <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
          No source citations available for this run.
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {sourceRefs.map((ref, idx) => (
            <div key={idx} className="flex items-start gap-2 p-3 rounded-md border bg-muted/20">
              <div className="mt-0.5 shrink-0">{getSourceIcon(ref.sourceType)}</div>
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs font-semibold leading-tight line-clamp-2" title={ref.title}>
                    {ref.title}
                  </span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded border font-mono uppercase shrink-0 ${getSourceBadgeColor(ref.sourceType)}`}>
                    {ref.sourceType.replace("_", " ")}
                  </span>
                </div>
                {ref.excerpt && (
                  <p className="text-[11px] text-muted-foreground line-clamp-2 italic border-l-2 border-muted pl-2">
                    "{ref.excerpt}"
                  </p>
                )}
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono">
                  {ref.domainTag && <span className="uppercase">{ref.domainTag}</span>}
                  {ref.confidence != null && (
                    <span className={ref.confidence > 0.8 ? "text-emerald-600" : ref.confidence > 0.5 ? "text-amber-600" : "text-red-600"}>
                      CONF {Math.round(ref.confidence * 100)}%
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const TYPE_COLORS: Record<string, string> = {
  principle: "text-violet-600 bg-violet-50 border-violet-200",
  playbook: "text-blue-600 bg-blue-50 border-blue-200",
  rule: "text-amber-600 bg-amber-50 border-amber-200",
  anti_pattern: "text-red-600 bg-red-50 border-red-200",
};

function scoreBar(score: number) {
  const pct = Math.round(score * 100);
  const color = score >= 0.65 ? "bg-emerald-400" : score >= 0.5 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-14 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-mono tabular-nums">{score.toFixed(3)}</span>
    </div>
  );
}

function CandidateRow({ c, rank, dimmed }: { c: ScoringTraceCandidateSummary; rank?: number; dimmed?: boolean }) {
  const typeClass = TYPE_COLORS[c.type] ?? "text-muted-foreground bg-muted border-border";
  return (
    <tr className={`border-b last:border-0 transition-opacity ${dimmed ? "opacity-40" : ""}`}>
      {rank != null && (
        <td className="px-2 py-1.5 text-center text-[10px] font-mono text-muted-foreground">{rank}</td>
      )}
      <td className="px-2 py-1.5">
        <span className={`text-[9px] px-1.5 py-0.5 rounded border font-mono uppercase ${typeClass}`}>
          {c.type.replace("_", " ")}
        </span>
      </td>
      <td className="px-2 py-1.5 max-w-[200px]">
        <span className="text-[11px] line-clamp-1" title={c.title}>{c.title}</span>
        {c.isCanonical && <span className="ml-1 text-[8px] text-emerald-600 font-mono uppercase">canon</span>}
      </td>
      <td className="px-2 py-1.5">{scoreBar(c.finalScore)}</td>
      <td className="px-2 py-1.5 text-[10px] font-mono text-muted-foreground tabular-nums">{c.similarity.toFixed(3)}</td>
      <td className="px-2 py-1.5 text-[10px] font-mono text-muted-foreground tabular-nums">{c.confidence.toFixed(2)}</td>
    </tr>
  );
}

function RetrievalTracePanel({ trace }: { trace: MemoScoringTrace }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"candidates" | "dedup" | "diversity" | "final">("candidates");

  const dedupCount = trace.removedByDedup.length;
  const diversityCount = trace.removedByDiversity.length;
  const finalCount = trace.finalSelected.length;

  return (
    <div className="rounded-md border border-dashed border-muted-foreground/30 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-muted/20 hover:bg-muted/40 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Retrieval Trace</span>
          <span className="text-[10px] font-mono text-muted-foreground/70">
            {trace.totalCandidatesReceived} candidates → {dedupCount} deduped → {diversityCount} diversity-capped → {finalCount} selected
          </span>
        </div>
        <div className="flex items-center gap-3 text-[10px] font-mono text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {trace.timings.total_ms}ms
          </span>
          {trace.frequencyGuardActive && (
            <span className="text-amber-600">freq-guard active</span>
          )}
          {trace.dedupFallbackUsed && (
            <span className="text-orange-600">dedup fallback</span>
          )}
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-3 space-y-3">
          <div className="flex items-center gap-4 text-[10px] font-mono text-muted-foreground border-b pb-2">
            <span className="flex items-center gap-1"><Zap className="h-3 w-3" /> scoring {trace.timings.scoring_ms}ms</span>
            <span className="flex items-center gap-1"><Filter className="h-3 w-3" /> dedup {trace.timings.dedup_ms}ms (threshold: {trace.dedupThreshold.toFixed(2)})</span>
            <span className="flex items-center gap-1"><Layers className="h-3 w-3" /> diversity {trace.timings.diversity_ms}ms</span>
            <span>total traces in DB: {trace.totalTraceCount}</span>
          </div>

          <div className="flex gap-1 text-[10px]">
            {(["candidates", "dedup", "diversity", "final"] as const).map((t) => {
              const labels: Record<typeof t, string> = {
                candidates: `Top ${trace.top20BeforeDedup.length} Candidates`,
                dedup: `Dedup Removed (${dedupCount})`,
                diversity: `Diversity Removed (${diversityCount})`,
                final: `Final Selected (${finalCount})`,
              };
              return (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-2.5 py-1 rounded font-mono transition-colors ${tab === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
                >
                  {labels[t]}
                </button>
              );
            })}
          </div>

          {tab === "candidates" && (
            <div className="overflow-x-auto rounded border">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="px-2 py-1.5 text-[10px] font-mono text-muted-foreground">#</th>
                    <th className="px-2 py-1.5 text-[10px] font-mono text-muted-foreground">Type</th>
                    <th className="px-2 py-1.5 text-[10px] font-mono text-muted-foreground">Title</th>
                    <th className="px-2 py-1.5 text-[10px] font-mono text-muted-foreground">Score</th>
                    <th className="px-2 py-1.5 text-[10px] font-mono text-muted-foreground">Sim</th>
                    <th className="px-2 py-1.5 text-[10px] font-mono text-muted-foreground">Conf</th>
                  </tr>
                </thead>
                <tbody>
                  {trace.top20BeforeDedup.map((c, i) => {
                    const wasRemoved =
                      trace.removedByDedup.some((r) => r.removed.id === c.id && r.removed.type === c.type) ||
                      trace.removedByDiversity.some((r) => r.removed.id === c.id && r.removed.type === c.type);
                    return <CandidateRow key={`${c.type}-${c.id}`} c={c} rank={i + 1} dimmed={wasRemoved} />;
                  })}
                </tbody>
              </table>
            </div>
          )}

          {tab === "dedup" && (
            <div className="space-y-2">
              {dedupCount === 0 ? (
                <p className="text-[11px] text-muted-foreground italic">No objects removed by deduplication.</p>
              ) : (
                trace.removedByDedup.map((r, i) => (
                  <div key={i} className="rounded border bg-red-50/40 p-2.5 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-0.5">
                        <p className="text-[11px] font-semibold text-red-700 line-clamp-1">{r.removed.title}</p>
                        <p className="text-[10px] text-muted-foreground font-mono">
                          {r.removed.type.replace("_", " ")} #{r.removed.id} · score {r.removed.finalScore.toFixed(3)}
                        </p>
                      </div>
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-red-100 text-red-600 border border-red-200 shrink-0">
                        DEDUP
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      Collided with <span className="font-semibold">{r.collidedWithTitle}</span>{" "}
                      ({r.collidedWithType.replace("_", " ")} #{r.collidedWithId}) at{" "}
                      <span className="font-mono text-red-600">{(r.embeddingSimilarity * 100).toFixed(1)}%</span> embedding similarity
                    </p>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === "diversity" && (
            <div className="space-y-2">
              {diversityCount === 0 ? (
                <p className="text-[11px] text-muted-foreground italic">No objects removed by diversity cap.</p>
              ) : (
                trace.removedByDiversity.map((r, i) => (
                  <div key={i} className="rounded border bg-orange-50/40 p-2.5 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-0.5">
                        <p className="text-[11px] font-semibold text-orange-700 line-clamp-1">{r.removed.title}</p>
                        <p className="text-[10px] text-muted-foreground font-mono">
                          {r.removed.type.replace("_", " ")} #{r.removed.id} · score {r.removed.finalScore.toFixed(3)}
                        </p>
                      </div>
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-orange-100 text-orange-600 border border-orange-200 shrink-0">
                        DIVERSITY
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground">{r.reason}</p>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === "final" && (
            <div className="overflow-x-auto rounded border">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="px-2 py-1.5 text-[10px] font-mono text-muted-foreground">Type</th>
                    <th className="px-2 py-1.5 text-[10px] font-mono text-muted-foreground">Title</th>
                    <th className="px-2 py-1.5 text-[10px] font-mono text-muted-foreground">Score</th>
                    <th className="px-2 py-1.5 text-[10px] font-mono text-muted-foreground">Sim</th>
                    <th className="px-2 py-1.5 text-[10px] font-mono text-muted-foreground">Conf</th>
                  </tr>
                </thead>
                <tbody>
                  {trace.finalSelected.map((c) => (
                    <CandidateRow key={`${c.type}-${c.id}`} c={c} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const EMPTY_PLACEHOLDER = "—";

function MemoSections({ sections }: { sections: MemoResponse["sections"] }) {
  return (
    <div className="space-y-5">
      <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground border-b pb-2">Analysis Sections</h3>

      <div className="space-y-1.5">
        <h4 className="text-sm font-bold text-foreground flex items-center gap-1.5">
          <Brain className="h-3.5 w-3.5 text-primary" />
          What the Brain Knows
        </h4>
        <div className={`text-sm leading-relaxed whitespace-pre-line ${sections.knownPrinciples ? "text-muted-foreground" : "text-muted-foreground/40 italic"}`}>
          {sections.knownPrinciples || EMPTY_PLACEHOLDER}
        </div>
      </div>

      <div className="space-y-1.5">
        <h4 className="text-sm font-bold text-foreground flex items-center gap-1.5">
          <BookOpen className="h-3.5 w-3.5 text-blue-500" />
          Brand-Specific Inference
        </h4>
        <div className={`text-sm leading-relaxed whitespace-pre-line ${sections.brandInference ? "text-muted-foreground" : "text-muted-foreground/40 italic"}`}>
          {sections.brandInference || "No brand context applied."}
        </div>
      </div>

      <div className="space-y-1.5">
        <h4 className="text-sm font-bold text-foreground flex items-center gap-1.5">
          <HelpCircle className="h-3.5 w-3.5 text-amber-500" />
          Uncertainty
        </h4>
        <div className={`text-sm leading-relaxed whitespace-pre-line ${sections.uncertainty ? "text-amber-800/80" : "text-muted-foreground/40 italic"}`}>
          {sections.uncertainty || EMPTY_PLACEHOLDER}
        </div>
      </div>

      <div className="space-y-1.5">
        <h4 className="text-sm font-bold text-foreground flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
          Missing Data
        </h4>
        <div className={`text-sm leading-relaxed whitespace-pre-line ${sections.missingData ? "text-red-800/80" : "text-muted-foreground/40 italic"}`}>
          {sections.missingData || EMPTY_PLACEHOLDER}
        </div>
      </div>
    </div>
  );
}

export function MemoResponseView({ memo }: MemoResponseViewProps) {
  return (
    <div className="space-y-4">
      <Card className="border-primary/20 shadow-sm">
        <CardHeader className="pb-3 bg-muted/30 border-b">
          <div className="flex justify-between items-start gap-4">
            <div className="space-y-1 min-w-0">
              <CardTitle className="text-lg font-serif text-primary">Strategic Intelligence Memo</CardTitle>
              <div className="text-xs text-muted-foreground font-mono flex flex-wrap items-center gap-2">
                <span>REF: {memo.id.toString().padStart(6, "0")}</span>
                <span>•</span>
                <span>TYPE: {memo.runType.replace(/_/g, " ").toUpperCase()}</span>
                <span>•</span>
                <span>DATE: {new Date(memo.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1.5 shrink-0">
              <Badge variant={memo.status === "done" ? "secondary" : "default"}>
                {memo.status.toUpperCase()}
              </Badge>
              {memo.confidence != null && (
                <div className="text-xs font-mono">
                  CONF:{" "}
                  <span className={memo.confidence > 0.8 ? "text-emerald-600" : memo.confidence > 0.5 ? "text-amber-600" : "text-red-600"}>
                    {Math.round(memo.confidence * 100)}%
                  </span>
                </div>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-5 space-y-5">
          {memo.query && (
            <div className="bg-primary/5 p-3 rounded-md border border-primary/10">
              <h4 className="text-[10px] font-bold text-primary mb-1 uppercase tracking-wider">Inquiry</h4>
              <p className="font-medium text-sm">{memo.query}</p>
            </div>
          )}

          <div className="space-y-1">
            <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Executive Summary</h4>
            <p className={`text-sm leading-relaxed ${memo.rationale_summary ? "" : "text-muted-foreground/40 italic"}`}>
              {memo.rationale_summary || EMPTY_PLACEHOLDER}
            </p>
          </div>

          {memo.missing_data && (
            <div className="bg-destructive/5 p-3 rounded-md border border-destructive/10 flex items-start gap-3">
              <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <h4 className="text-[10px] font-bold text-destructive uppercase tracking-wider">Data Gaps Identified</h4>
                <p className="text-sm text-destructive/90 leading-relaxed">{memo.missing_data}</p>
              </div>
            </div>
          )}

          <Separator />

          <MemoSections sections={memo.sections} />
        </CardContent>
      </Card>

      <SourcesPanel sourceRefs={memo.source_refs} />

      {memo.scoring_trace && (
        <RetrievalTracePanel trace={memo.scoring_trace} />
      )}
    </div>
  );
}

interface MemoOutputFromRunProps {
  run: MappingRunDetail;
}

interface ParsedOutputJson {
  sections?: {
    knownPrinciples?: string;
    brandInference?: string | null;
    uncertainty?: string;
    missingData?: string;
    rationale?: string;
    confidence?: number;
    missingDataSummary?: string;
    scoredPlaybooks?: unknown[];
  };
  sourceRefs?: Array<{
    sourceType: string;
    sourceId: number;
    title: string;
    domainTag?: string | null;
    confidence?: number | null;
    excerpt?: string | null;
  }>;
  scoredPlaybooks?: unknown[];
}

export function MemoOutputFromRun({ run }: MemoOutputFromRunProps) {
  let parsedOutput: ParsedOutputJson = {};
  try {
    parsedOutput = JSON.parse(run.outputJson) as ParsedOutputJson;
  } catch {
    parsedOutput = {};
  }

  const s = parsedOutput.sections ?? {};
  const sections = {
    knownPrinciples: s.knownPrinciples ?? "",
    brandInference: s.brandInference ?? null,
    uncertainty: s.uncertainty ?? "",
    missingData: s.missingData ?? "",
  };

  const confidence = s.confidence ?? null;

  const validSourceTypes = Object.values(SourceRefSourceType);
  const rawSourceRefs = parsedOutput.sourceRefs ?? [];

  let sourceRefs: SourceRef[];
  if (rawSourceRefs.length > 0) {
    sourceRefs = rawSourceRefs.map((ref) => ({
      sourceType: (validSourceTypes.includes(ref.sourceType as SourceRefSourceType)
        ? ref.sourceType
        : "document_chunk") as SourceRefSourceType,
      sourceId: ref.sourceId,
      title: ref.title,
      domainTag: ref.domainTag ?? null,
      confidence: ref.confidence ?? null,
      excerpt: ref.excerpt ?? null,
    }));
  } else {
    sourceRefs = run.sources.map((s) => {
      const sourceType = (validSourceTypes.includes(s.sourceType as SourceRefSourceType)
        ? s.sourceType
        : "document_chunk") as SourceRefSourceType;
      const label = sourceType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      return {
        sourceType,
        sourceId: s.sourceId,
        title: `${label} #${s.sourceId}`,
        domainTag: null,
        confidence: null,
        excerpt: null,
      };
    });
  }

  const memo: MemoResponse = {
    id: run.id,
    runType: run.runType as MemoResponse["runType"],
    query: run.query,
    rationale_summary: run.rationale_summary,
    confidence,
    missing_data: run.missing_data,
    sections,
    source_refs: sourceRefs,
    status: run.status,
    createdAt: run.createdAt,
  };

  return <MemoResponseView memo={memo} />;
}
