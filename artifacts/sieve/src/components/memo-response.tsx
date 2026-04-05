import { MemoResponse } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { FileText, Link as LinkIcon, AlertTriangle } from "lucide-react";

interface MemoResponseViewProps {
  memo: MemoResponse;
}

export function MemoResponseView({ memo }: MemoResponseViewProps) {
  return (
    <div className="space-y-6">
      <Card className="border-primary/20 shadow-sm">
        <CardHeader className="pb-3 bg-muted/30 border-b">
          <div className="flex justify-between items-start">
            <div className="space-y-1">
              <CardTitle className="text-xl font-serif text-primary">Strategic Intelligence Memo</CardTitle>
              <div className="text-xs text-muted-foreground font-mono flex items-center gap-2">
                <span>REF: {memo.id.toString().padStart(6, '0')}</span>
                <span>•</span>
                <span>TYPE: {memo.runType}</span>
                <span>•</span>
                <span>DATE: {new Date(memo.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <Badge variant={memo.status === "done" ? "default" : "secondary"}>
                {memo.status.toUpperCase()}
              </Badge>
              {memo.confidence !== undefined && memo.confidence !== null && (
                <div className="text-xs font-medium">
                  CONFIDENCE: <span className={memo.confidence > 0.8 ? "text-emerald-500" : memo.confidence > 0.5 ? "text-amber-500" : "text-destructive"}>
                    {Math.round(memo.confidence * 100)}%
                  </span>
                </div>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-6 space-y-8">
          {memo.query && (
            <div className="bg-primary/5 p-4 rounded-md border border-primary/10">
              <h4 className="text-xs font-bold text-primary mb-2 uppercase tracking-wider">Inquiry</h4>
              <p className="font-medium">{memo.query}</p>
            </div>
          )}

          {memo.rationale_summary && (
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Executive Summary</h4>
              <p className="text-sm leading-relaxed">{memo.rationale_summary}</p>
            </div>
          )}

          {memo.missing_data && (
            <div className="bg-destructive/5 p-4 rounded-md border border-destructive/10 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h4 className="text-xs font-bold text-destructive uppercase tracking-wider">Data Gaps Identified</h4>
                <p className="text-sm text-destructive/90 leading-relaxed">{memo.missing_data}</p>
              </div>
            </div>
          )}

          <Separator />

          <div className="space-y-6">
            <h3 className="text-lg font-serif font-bold border-b pb-2">Analysis Sections</h3>
            
            {memo.sections.knownPrinciples && (
              <div className="space-y-2">
                <h4 className="text-sm font-bold text-primary">Established Principles</h4>
                <div className="prose prose-sm max-w-none prose-p:leading-relaxed text-sm">
                  {memo.sections.knownPrinciples}
                </div>
              </div>
            )}

            {memo.sections.brandInference && (
              <div className="space-y-2">
                <h4 className="text-sm font-bold text-primary">Brand Context & Inference</h4>
                <div className="prose prose-sm max-w-none prose-p:leading-relaxed text-sm">
                  {memo.sections.brandInference}
                </div>
              </div>
            )}

            {memo.sections.uncertainty && (
              <div className="space-y-2">
                <h4 className="text-sm font-bold text-amber-600 dark:text-amber-500">Uncertainties & Risks</h4>
                <div className="prose prose-sm max-w-none prose-p:leading-relaxed text-sm text-muted-foreground">
                  {memo.sections.uncertainty}
                </div>
              </div>
            )}
            
            {memo.sections.missingData && (
              <div className="space-y-2">
                <h4 className="text-sm font-bold text-destructive">Critical Missing Data</h4>
                <div className="prose prose-sm max-w-none prose-p:leading-relaxed text-sm text-muted-foreground">
                  {memo.sections.missingData}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {memo.source_refs && memo.source_refs.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Sources & Citations</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {memo.source_refs.map((ref, idx) => (
              <Card key={idx} className="bg-muted/20">
                <CardContent className="p-3">
                  <div className="flex items-start gap-3">
                    <FileText className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold line-clamp-1" title={ref.title}>{ref.title}</span>
                        <Badge variant="outline" className="text-[10px] px-1 py-0">{ref.sourceType}</Badge>
                      </div>
                      {ref.excerpt && (
                        <p className="text-xs text-muted-foreground line-clamp-3 italic border-l-2 pl-2">
                          "{ref.excerpt}"
                        </p>
                      )}
                      {(ref.domainTag || ref.confidence) && (
                        <div className="flex items-center gap-2 pt-1 text-[10px] text-muted-foreground font-mono">
                          {ref.domainTag && <span>{ref.domainTag}</span>}
                          {ref.confidence && <span>CONF: {Math.round(ref.confidence * 100)}%</span>}
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
