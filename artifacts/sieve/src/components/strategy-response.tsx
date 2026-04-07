import { MemoResponse } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import {
  Target, TrendingUp, AlertTriangle, HelpCircle, FileText, BarChart2, BookOpen,
} from "lucide-react";

interface StrategyTheme {
  themeName: string;
  rationale: string;
  relatedPlaybooks: string[];
  antiPatterns: string[];
  missing?: string;
}

function parseThemes(brandInference?: string | null): StrategyTheme[] {
  if (!brandInference) return [];

  const lines = brandInference.split("\n").map((l) => l.trim()).filter(Boolean);
  const themes: StrategyTheme[] = [];
  let current: StrategyTheme | null = null;

  for (const line of lines) {
    const themeMatch =
      line.match(/^(?:theme\s*\d+[:.]\s*)(.+)$/i) ||
      line.match(/^(\d+\.\s+.+?)(?:\s*[-–:].+)?$/) ||
      line.match(/^\*{1,2}(.+?)\*{1,2}/) ||
      line.match(/^#{1,3}\s+(.+)/);

    const isNumberedHeading = /^\d+\.\s+[A-Z]/.test(line) && line.length < 80;
    const isBoldHeading = line.startsWith("**") && line.endsWith("**");
    const isThemeLabel = /^theme\s*\d+/i.test(line);

    if (isNumberedHeading || isBoldHeading || isThemeLabel) {
      if (current) themes.push(current);
      current = {
        themeName: line.replace(/^\d+\.\s+/, "").replace(/\*\*/g, "").replace(/^theme\s*\d+[:.]\s*/i, "").trim(),
        rationale: "",
        relatedPlaybooks: [],
        antiPatterns: [],
      };
      continue;
    }

    if (current) {
      if (/playbook|PB:/i.test(line)) {
        current.relatedPlaybooks.push(line.replace(/^[-•*]\s*/, ""));
      } else if (/anti.?pattern|AP:|avoid/i.test(line)) {
        current.antiPatterns.push(line.replace(/^[-•*]\s*/, ""));
      } else if (/missing|gap/i.test(line)) {
        current.missing = (current.missing ? current.missing + " " : "") + line;
      } else {
        current.rationale = (current.rationale ? current.rationale + " " : "") + line;
      }
    }
  }

  if (current) themes.push(current);

  if (themes.length === 0 && brandInference.trim()) {
    themes.push({
      themeName: "Strategic Direction",
      rationale: brandInference,
      relatedPlaybooks: [],
      antiPatterns: [],
    });
  }

  return themes;
}

function ThemeCard({ theme, idx }: { theme: StrategyTheme; idx: number }) {
  return (
    <Card className="overflow-hidden border border-primary/10 shadow-sm">
      <CardHeader className="bg-gradient-to-r from-primary/5 to-transparent pb-3">
        <div className="flex items-start gap-3">
          <div className="h-8 w-8 rounded-full bg-primary/15 flex items-center justify-center shrink-0 mt-0.5">
            <span className="text-sm font-bold text-primary">{idx + 1}</span>
          </div>
          <div>
            <h3 className="text-base font-serif font-bold leading-tight">{theme.themeName}</h3>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-4 space-y-4">
        {theme.rationale && (
          <div>
            <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1.5 flex items-center gap-1">
              <TrendingUp className="h-3 w-3" />Rationale
            </p>
            <p className="text-sm text-foreground/80 leading-relaxed">{theme.rationale}</p>
          </div>
        )}

        {theme.relatedPlaybooks.length > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1.5 flex items-center gap-1">
              <BookOpen className="h-3 w-3" />Related Playbooks
            </p>
            <div className="space-y-1">
              {theme.relatedPlaybooks.map((pb, i) => (
                <Link key={i} href="/playbooks">
                  <div className="flex items-center gap-2 text-xs text-primary cursor-pointer hover:underline p-1.5 rounded hover:bg-primary/5">
                    <BookOpen className="h-3.5 w-3.5 shrink-0" />
                    {pb}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {theme.antiPatterns.length > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1.5 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3 text-amber-500" />Avoid These Anti-Patterns
            </p>
            <div className="space-y-1">
              {theme.antiPatterns.map((ap, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-100 p-1.5 rounded">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-500" />
                  {ap}
                </div>
              ))}
            </div>
          </div>
        )}

        {theme.missing && (
          <div className="bg-muted/30 border rounded p-2.5">
            <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1 flex items-center gap-1">
              <HelpCircle className="h-3 w-3" />Missing Data
            </p>
            <p className="text-xs text-muted-foreground">{theme.missing}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface StrategyResponseViewProps {
  memo: MemoResponse;
}

export function StrategyResponseView({ memo }: StrategyResponseViewProps) {
  const themes = parseThemes(memo.sections?.brandInference);

  const confidence = memo.confidence;
  const missingDataSummary = memo.sections?.missingData ?? memo.missing_data;
  const rationale = memo.rationale_summary;
  const sourceRefs: Array<{ sourceType?: string | null; title?: string | null; excerpt?: string | null; domainTag?: string | null }> =
    memo.source_refs ?? [];

  return (
    <div className="space-y-8">
      {rationale && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-5">
            <p className="text-[10px] font-bold uppercase text-primary/70 mb-2 flex items-center gap-1">
              <BarChart2 className="h-3 w-3" />Executive Summary
            </p>
            <p className="text-sm leading-relaxed font-medium">{rationale}</p>
            {confidence !== undefined && (
              <div className="mt-3 flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Confidence:</span>
                <Badge variant="secondary" className="text-xs font-mono">
                  {typeof confidence === "number" ? Math.round(confidence * 100) + "%" : confidence}
                </Badge>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        <h2 className="text-base font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
          <Target className="h-4 w-4" />Strategic Themes
        </h2>
        {themes.length > 0 ? (
          <div className="space-y-4">
            {themes.map((theme, idx) => (
              <ThemeCard key={idx} theme={theme} idx={idx} />
            ))}
          </div>
        ) : (
          <Card className="border-dashed">
            <CardContent className="p-6 text-center text-muted-foreground text-sm">
              No structured themes extracted. Raw brand inference content unavailable.
            </CardContent>
          </Card>
        )}
      </div>

      {missingDataSummary && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase text-amber-700 mb-1 flex items-center gap-1">
              <HelpCircle className="h-3 w-3" />Key Data Gap
            </p>
            <p className="text-sm text-amber-900">{missingDataSummary}</p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground border-b pb-2 flex items-center gap-2">
          <FileText className="h-3.5 w-3.5" />
          Source References ({sourceRefs.length > 0 ? sourceRefs.length : "none"})
        </h3>
        {sourceRefs.length > 0 ? (
          <div className="grid gap-2 md:grid-cols-2">
            {sourceRefs.map((ref, i) => (
              <div key={i} className="flex flex-col gap-1 p-3 rounded border bg-muted/10 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase font-mono bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
                    {ref.sourceType?.replace("_", " ") ?? "source"}
                  </span>
                  {ref.domainTag && (
                    <Badge variant="outline" className="text-[9px] font-mono uppercase">{ref.domainTag}</Badge>
                  )}
                </div>
                <span className="font-semibold">{ref.title ?? "Unnamed source"}</span>
                {ref.excerpt && <p className="text-muted-foreground line-clamp-2">{ref.excerpt}</p>}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic py-2">
            No source citations were returned for this strategy generation.
          </p>
        )}
      </div>
    </div>
  );
}
