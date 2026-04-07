import { MemoResponse } from "@workspace/api-client-react";
import { MemoResponseView } from "@/components/memo-response";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import {
  Target, TrendingUp, AlertTriangle, HelpCircle, BookOpen,
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
    const isNumberedHeading = /^\d+\.\s+[A-Z]/.test(line) && line.length < 100;
    const isBoldHeading = line.startsWith("**") && line.endsWith("**");
    const isThemeLabel = /^theme\s*\d+/i.test(line);
    const isHashHeading = /^#{1,3}\s+/.test(line);

    if (isNumberedHeading || isBoldHeading || isThemeLabel || isHashHeading) {
      if (current) themes.push(current);
      current = {
        themeName: line
          .replace(/^\d+\.\s+/, "")
          .replace(/\*\*/g, "")
          .replace(/^theme\s*\d+[:.]\s*/i, "")
          .replace(/^#{1,3}\s+/, "")
          .trim(),
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
          <h3 className="text-base font-serif font-bold leading-tight">{theme.themeName}</h3>
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

  return (
    <div className="space-y-8">
      <MemoResponseView memo={memo} />

      {themes.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-base font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2 pt-2">
            <Target className="h-4 w-4" />
            Strategic Themes ({themes.length})
          </h2>
          <div className="space-y-4">
            {themes.map((theme, idx) => (
              <ThemeCard key={idx} theme={theme} idx={idx} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
