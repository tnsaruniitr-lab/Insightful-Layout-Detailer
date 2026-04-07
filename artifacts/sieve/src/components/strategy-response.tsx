import { MemoResponse, SourceRef, StrategyTheme } from "@workspace/api-client-react";
import { MemoResponseView } from "@/components/memo-response";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import {
  Target, BookOpen, AlertTriangle, Lightbulb, Scale, Database, HelpCircle,
} from "lucide-react";

function sourceRefsByIds(
  refs: SourceRef[],
  type: string,
  ids: number[]
): SourceRef[] {
  if (ids.length === 0) return [];
  const idSet = new Set(ids);
  return refs.filter((r) => r.sourceType === type && idSet.has(r.sourceId));
}

function SourceBadge({ ref }: { ref: SourceRef }) {
  const colorMap: Record<string, string> = {
    playbook: "bg-blue-50 text-blue-700 border-blue-200",
    principle: "bg-violet-50 text-violet-700 border-violet-200",
    anti_pattern: "bg-red-50 text-red-700 border-red-200",
    rule: "bg-amber-50 text-amber-700 border-amber-200",
  };
  const iconMap: Record<string, React.ReactNode> = {
    playbook: <BookOpen className="h-3 w-3" />,
    principle: <Lightbulb className="h-3 w-3" />,
    anti_pattern: <AlertTriangle className="h-3 w-3" />,
    rule: <Scale className="h-3 w-3" />,
  };
  return (
    <Link href="/playbooks">
      <Badge
        variant="outline"
        className={`cursor-pointer hover:opacity-80 transition-opacity flex items-center gap-1 ${colorMap[ref.sourceType] ?? ""}`}
      >
        {iconMap[ref.sourceType]}
        <span className="max-w-[140px] truncate">{ref.title}</span>
      </Badge>
    </Link>
  );
}

function ThemeCard({
  theme,
  index,
  sourceRefs,
}: {
  theme: StrategyTheme;
  index: number;
  sourceRefs: SourceRef[];
}) {
  const linkedPlaybooks = sourceRefsByIds(sourceRefs, "playbook", theme.playbookIds);
  const linkedAntiPatterns = sourceRefsByIds(sourceRefs, "anti_pattern", theme.antiPatternIds);

  return (
    <Card className="border-l-4 border-l-primary/60">
      <CardHeader className="pb-2">
        <div className="flex items-start gap-3">
          <div className="h-7 w-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold shrink-0 mt-0.5">
            {index + 1}
          </div>
          <div>
            <h3 className="font-bold text-base">{theme.name}</h3>
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{theme.rationale}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {linkedPlaybooks.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-700 mb-1.5 flex items-center gap-1">
              <BookOpen className="h-3 w-3" /> Relevant Playbooks
            </p>
            <div className="flex flex-wrap gap-1.5">
              {linkedPlaybooks.map((ref) => (
                <SourceBadge key={ref.sourceId} ref={ref} />
              ))}
            </div>
          </div>
        )}
        {linkedAntiPatterns.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-red-700 mb-1.5 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Anti-Patterns to Avoid
            </p>
            <div className="flex flex-wrap gap-1.5">
              {linkedAntiPatterns.map((ref) => (
                <SourceBadge key={ref.sourceId} ref={ref} />
              ))}
            </div>
          </div>
        )}
        {theme.missingData && (
          <div className="bg-amber-50 border border-amber-100 rounded p-2.5">
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-700 mb-1 flex items-center gap-1">
              <HelpCircle className="h-3 w-3" /> Data Gap
            </p>
            <p className="text-xs text-amber-800 leading-relaxed">{theme.missingData}</p>
          </div>
        )}
        {(linkedPlaybooks.length === 0 && linkedAntiPatterns.length === 0) && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
            <Database className="h-3.5 w-3.5" />
            <span>No matched intelligence library references — run strategy after ingesting more knowledge documents.</span>
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
  const themes = memo.sections?.themes ?? null;
  const hasThemes = Array.isArray(themes) && themes.length > 0;

  return (
    <div className="space-y-6">
      <MemoResponseView memo={memo} />

      {hasThemes && (
        <div className="space-y-4">
          <h2 className="text-base font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
            <Target className="h-4 w-4" />
            Strategic Themes ({themes!.length})
          </h2>
          <div className="space-y-4">
            {themes!.map((theme, i) => (
              <ThemeCard
                key={`${theme.name}-${i}`}
                theme={theme}
                index={i}
                sourceRefs={memo.source_refs ?? []}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
