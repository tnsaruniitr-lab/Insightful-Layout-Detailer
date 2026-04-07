import { MemoResponse, SourceRef } from "@workspace/api-client-react";
import { MemoResponseView } from "@/components/memo-response";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import {
  Target, BookOpen, AlertTriangle, Lightbulb, Scale,
} from "lucide-react";

function groupSourceRefs(refs: SourceRef[]): {
  playbooks: SourceRef[];
  principles: SourceRef[];
  antiPatterns: SourceRef[];
  rules: SourceRef[];
} {
  return {
    playbooks: refs.filter((r) => r.sourceType === "playbook"),
    principles: refs.filter((r) => r.sourceType === "principle"),
    antiPatterns: refs.filter((r) => r.sourceType === "anti_pattern"),
    rules: refs.filter((r) => r.sourceType === "rule"),
  };
}

function SourceRefLink({
  ref,
  href,
  icon,
}: {
  ref: SourceRef;
  href: string;
  icon: React.ReactNode;
}) {
  return (
    <Link href={href}>
      <div className="flex items-start gap-2 p-2.5 rounded border border-transparent hover:border-primary/20 hover:bg-primary/5 cursor-pointer transition-colors group">
        <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5 group-hover:bg-primary/10">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium truncate">{ref.title}</span>
            {ref.domainTag && (
              <Badge variant="outline" className="text-[9px] font-mono uppercase shrink-0">{ref.domainTag}</Badge>
            )}
          </div>
          {ref.excerpt && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{ref.excerpt}</p>
          )}
          {ref.confidence != null && (
            <span className={`text-[10px] font-mono ${ref.confidence > 0.8 ? "text-emerald-600" : ref.confidence > 0.5 ? "text-amber-600" : "text-red-600"}`}>
              CONF {Math.round(ref.confidence * 100)}%
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

interface StrategyResponseViewProps {
  memo: MemoResponse;
}

export function StrategyResponseView({ memo }: StrategyResponseViewProps) {
  const { playbooks, principles, antiPatterns, rules } = groupSourceRefs(memo.source_refs ?? []);

  const hasPriorities = playbooks.length > 0 || principles.length > 0 || antiPatterns.length > 0 || rules.length > 0;

  return (
    <div className="space-y-6">
      <MemoResponseView memo={memo} />

      {hasPriorities && (
        <div className="space-y-4">
          <h2 className="text-base font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
            <Target className="h-4 w-4" />
            Strategic Resources
          </h2>

          <div className="grid gap-4 md:grid-cols-2">
            {playbooks.length > 0 && (
              <Card className="border-blue-100">
                <CardHeader className="pb-2 bg-blue-50/50 border-b border-blue-100">
                  <div className="flex items-center gap-2 text-sm font-bold text-blue-700">
                    <BookOpen className="h-4 w-4" />
                    Recommended Playbooks ({playbooks.length})
                  </div>
                  <p className="text-xs text-blue-600/70">Click to browse in Playbooks</p>
                </CardHeader>
                <CardContent className="pt-3 space-y-1">
                  {playbooks.map((ref) => (
                    <SourceRefLink
                      key={ref.sourceId}
                      ref={ref}
                      href="/playbooks"
                      icon={<BookOpen className="h-3.5 w-3.5 text-blue-500" />}
                    />
                  ))}
                </CardContent>
              </Card>
            )}

            {antiPatterns.length > 0 && (
              <Card className="border-red-100">
                <CardHeader className="pb-2 bg-red-50/50 border-b border-red-100">
                  <div className="flex items-center gap-2 text-sm font-bold text-red-700">
                    <AlertTriangle className="h-4 w-4" />
                    Anti-Patterns to Avoid ({antiPatterns.length})
                  </div>
                  <p className="text-xs text-red-600/70">Click to browse in Playbooks</p>
                </CardHeader>
                <CardContent className="pt-3 space-y-1">
                  {antiPatterns.map((ref) => (
                    <SourceRefLink
                      key={ref.sourceId}
                      ref={ref}
                      href="/playbooks"
                      icon={<AlertTriangle className="h-3.5 w-3.5 text-red-500" />}
                    />
                  ))}
                </CardContent>
              </Card>
            )}

            {principles.length > 0 && (
              <Card className="border-violet-100">
                <CardHeader className="pb-2 bg-violet-50/50 border-b border-violet-100">
                  <div className="flex items-center gap-2 text-sm font-bold text-violet-700">
                    <Lightbulb className="h-4 w-4" />
                    Relevant Principles ({principles.length})
                  </div>
                  <p className="text-xs text-violet-600/70">Click to browse in Playbooks</p>
                </CardHeader>
                <CardContent className="pt-3 space-y-1">
                  {principles.map((ref) => (
                    <SourceRefLink
                      key={ref.sourceId}
                      ref={ref}
                      href="/playbooks"
                      icon={<Lightbulb className="h-3.5 w-3.5 text-violet-500" />}
                    />
                  ))}
                </CardContent>
              </Card>
            )}

            {rules.length > 0 && (
              <Card className="border-amber-100">
                <CardHeader className="pb-2 bg-amber-50/50 border-b border-amber-100">
                  <div className="flex items-center gap-2 text-sm font-bold text-amber-700">
                    <Scale className="h-4 w-4" />
                    Applied Rules ({rules.length})
                  </div>
                  <p className="text-xs text-amber-600/70">Click to browse in Playbooks</p>
                </CardHeader>
                <CardContent className="pt-3 space-y-1">
                  {rules.map((ref) => (
                    <SourceRefLink
                      key={ref.sourceId}
                      ref={ref}
                      href="/playbooks"
                      icon={<Scale className="h-3.5 w-3.5 text-amber-500" />}
                    />
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
