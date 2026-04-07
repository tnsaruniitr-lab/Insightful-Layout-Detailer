import { MemoResponse, MappingRunDetail, SourceRef, SourceRefSourceType } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { FileText, AlertTriangle, BookOpen, Brain, HelpCircle, Database } from "lucide-react";

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
