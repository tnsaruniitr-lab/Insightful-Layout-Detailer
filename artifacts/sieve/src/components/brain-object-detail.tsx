import { useGetPlaybook, Principle, Rule, AntiPattern, Playbook } from "@workspace/api-client-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import {
  BrainCircuit, CheckCircle, BookOpen, ShieldAlert, FileText,
  Calendar, Tag, ArrowRight, AlertTriangle, Link2,
} from "lucide-react";

type BrainObjectType = "principle" | "rule" | "playbook" | "anti_pattern";

interface SourceRef {
  sourceType?: string;
  sourceId?: number;
  title?: string;
  domainTag?: string | null;
  documentTitle?: string | null;
  excerpt?: string | null;
}

function parseJson<T>(json: string, fallback: T): T {
  try { return JSON.parse(json) as T; } catch { return fallback; }
}

function ConfBadge({ score }: { score?: string | null }) {
  if (!score) return null;
  const n = parseFloat(score);
  const color = n > 0.8
    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : n > 0.5
    ? "bg-amber-50 text-amber-700 border-amber-200"
    : "bg-red-50 text-red-700 border-red-200";
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded border font-mono ${color}`}>
      CONF {Math.round(n * 100)}%
    </span>
  );
}

function MetaRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground shrink-0">{icon}</span>
      <span className="text-muted-foreground shrink-0 w-20">{label}</span>
      <span className="font-mono text-foreground">{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{title}</h4>
      {children}
    </div>
  );
}

function SourceRefsPanel({ json }: { json: string }) {
  const refs = parseJson<SourceRef[]>(json, []);
  if (refs.length === 0) {
    return <div className="text-xs text-muted-foreground italic">No source references recorded for this object.</div>;
  }
  return (
    <div className="space-y-2">
      {refs.map((ref, i) => (
        <div key={i} className="rounded border bg-muted/20 p-3 space-y-1">
          <div className="flex items-start justify-between gap-2">
            <span className="text-xs font-semibold leading-tight">
              {ref.title || ref.documentTitle || `Source #${ref.sourceId ?? i + 1}`}
            </span>
            {ref.sourceType && (
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border bg-muted text-muted-foreground shrink-0 uppercase">
                {ref.sourceType.replace("_", " ")}
              </span>
            )}
          </div>
          {ref.excerpt && (
            <p className="text-[11px] text-muted-foreground italic border-l-2 border-muted pl-2 line-clamp-3">
              "{ref.excerpt}"
            </p>
          )}
          {ref.domainTag && (
            <span className="text-[10px] font-mono text-muted-foreground uppercase">{ref.domainTag}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function PrincipleDetail({ obj }: { obj: Principle }) {
  return (
    <div className="space-y-5">
      <Section title="Statement">
        <p className="text-sm leading-relaxed">{obj.statement}</p>
      </Section>

      {obj.explanation && (
        <Section title="Explanation">
          <p className="text-sm leading-relaxed text-muted-foreground">{obj.explanation}</p>
        </Section>
      )}

      <div className="text-xs font-mono text-muted-foreground">
        Sources indexed: {obj.sourceCount}
      </div>

      <Separator />

      <Section title="Source Documents">
        <SourceRefsPanel json={obj.sourceRefsJson} />
      </Section>
    </div>
  );
}

function RuleDetail({ obj }: { obj: Rule }) {
  return (
    <div className="space-y-5">
      <Section title="Logic">
        <div className="space-y-2">
          <div className="rounded border border-primary/20 bg-primary/5 p-4">
            <span className="text-[10px] font-bold text-primary uppercase block mb-2">IF</span>
            <p className="text-sm leading-relaxed">{obj.ifCondition}</p>
          </div>
          <div className="flex justify-center">
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="rounded border bg-muted/40 p-4">
            <span className="text-[10px] font-bold uppercase block mb-2">THEN</span>
            <p className="text-sm leading-relaxed">{obj.thenLogic}</p>
          </div>
        </div>
      </Section>

      <Separator />

      <Section title="Source Documents">
        <SourceRefsPanel json={obj.sourceRefsJson} />
      </Section>
    </div>
  );
}

function AntiPatternDetail({ obj }: { obj: AntiPattern }) {
  const signals = parseJson<string[]>(obj.signalsJson, []);

  return (
    <div className="space-y-5">
      <Section title="Description">
        <p className="text-sm leading-relaxed">{obj.description}</p>
      </Section>

      {signals.length > 0 && (
        <Section title="Warning Signals">
          <ul className="space-y-1.5">
            {signals.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                <span className="text-muted-foreground">{s}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Separator />

      <Section title="Source Documents">
        <SourceRefsPanel json={obj.sourceRefsJson} />
      </Section>
    </div>
  );
}

function PlaybookDetail({ obj }: { obj: Playbook }) {
  const { data: full, isLoading } = useGetPlaybook(obj.id);

  return (
    <div className="space-y-5">
      <Section title="Summary">
        <p className="text-sm leading-relaxed">{obj.summary}</p>
      </Section>

      {(obj.useWhen || obj.avoidWhen) && (
        <div className="grid grid-cols-2 gap-3">
          {obj.useWhen && (
            <Section title="Use When">
              <div className="rounded border border-emerald-200 bg-emerald-50/50 p-3">
                <p className="text-xs leading-relaxed text-emerald-800">{obj.useWhen}</p>
              </div>
            </Section>
          )}
          {obj.avoidWhen && (
            <Section title="Avoid When">
              <div className="rounded border border-red-200 bg-red-50/50 p-3">
                <p className="text-xs leading-relaxed text-red-800">{obj.avoidWhen}</p>
              </div>
            </Section>
          )}
        </div>
      )}

      {obj.expectedOutcomes && (
        <Section title="Expected Outcomes">
          <p className="text-sm leading-relaxed text-muted-foreground">{obj.expectedOutcomes}</p>
        </Section>
      )}

      <Section title="Steps">
        {isLoading ? (
          <p className="text-xs text-muted-foreground">Loading steps…</p>
        ) : full?.steps && full.steps.length > 0 ? (
          <ol className="space-y-2">
            {full.steps
              .slice()
              .sort((a, b) => a.stepOrder - b.stepOrder)
              .map((step) => (
                <li key={step.id} className="flex items-start gap-3 rounded border bg-muted/20 p-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-[11px] font-bold">
                    {step.stepOrder}
                  </span>
                  <div className="space-y-0.5 flex-1 min-w-0">
                    <p className="text-sm font-semibold leading-tight">{step.stepTitle}</p>
                    {step.stepDescription && (
                      <p className="text-xs text-muted-foreground leading-relaxed">{step.stepDescription}</p>
                    )}
                  </div>
                </li>
              ))}
          </ol>
        ) : (
          <p className="text-xs text-muted-foreground italic">No steps recorded for this playbook.</p>
        )}
      </Section>

      <Separator />

      <Section title="Source Documents">
        <SourceRefsPanel json={obj.sourceRefsJson} />
      </Section>
    </div>
  );
}

const TYPE_META: Record<BrainObjectType, { icon: React.ReactNode; label: string; color: string }> = {
  principle: {
    icon: <BrainCircuit className="h-4 w-4 text-violet-500" />,
    label: "Principle",
    color: "bg-violet-50 text-violet-700 border-violet-200",
  },
  rule: {
    icon: <CheckCircle className="h-4 w-4 text-amber-500" />,
    label: "Rule",
    color: "bg-amber-50 text-amber-700 border-amber-200",
  },
  playbook: {
    icon: <BookOpen className="h-4 w-4 text-blue-500" />,
    label: "Playbook",
    color: "bg-blue-50 text-blue-700 border-blue-200",
  },
  anti_pattern: {
    icon: <ShieldAlert className="h-4 w-4 text-destructive" />,
    label: "Anti-Pattern",
    color: "bg-red-50 text-red-700 border-red-200",
  },
};

type AnyBrainObject = Principle | Rule | AntiPattern | Playbook;

function getTitle(type: BrainObjectType, obj: AnyBrainObject): string {
  if (type === "rule") return (obj as Rule).name;
  if (type === "playbook") return (obj as Playbook).name;
  return (obj as Principle).title;
}

function getStatus(obj: AnyBrainObject): string {
  return (obj as Principle).status;
}

function getDomain(obj: AnyBrainObject): string {
  return (obj as Principle).domainTag;
}

function getConf(obj: AnyBrainObject): string | null | undefined {
  return (obj as Principle).confidenceScore;
}

function getCreatedAt(obj: AnyBrainObject): string {
  return (obj as Principle).createdAt;
}

export interface BrainObjectDetailProps {
  type: BrainObjectType;
  object: AnyBrainObject | null;
  onClose: () => void;
}

export function BrainObjectDetail({ type, object, onClose }: BrainObjectDetailProps) {
  const meta = TYPE_META[type];

  return (
    <Sheet open={!!object} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto flex flex-col gap-0 p-0">
        {object && (
          <>
            <SheetHeader className="px-6 py-5 border-b bg-muted/20 space-y-3 text-left">
              <div className="flex items-center gap-2 flex-wrap">
                {meta.icon}
                <span className={`text-[10px] px-2 py-0.5 rounded border font-mono uppercase ${meta.color}`}>
                  {meta.label}
                </span>
                <span className={`text-[10px] px-2 py-0.5 rounded border font-mono uppercase ${
                  getStatus(object) === "canonical"
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : "bg-muted text-muted-foreground border-border"
                }`}>
                  {getStatus(object)}
                </span>
                <ConfBadge score={getConf(object)} />
              </div>

              <SheetTitle className="text-xl font-serif leading-tight">
                {getTitle(type, object)}
              </SheetTitle>

              <div className="space-y-1.5 pt-1">
                <MetaRow icon={<Tag className="h-3.5 w-3.5" />} label="Domain" value={getDomain(object).toUpperCase()} />
                {type === "rule" && (
                  <MetaRow icon={<FileText className="h-3.5 w-3.5" />} label="Rule type" value={(object as Rule).ruleType} />
                )}
                {type === "anti_pattern" && (
                  <MetaRow icon={<AlertTriangle className="h-3.5 w-3.5" />} label="Risk level" value={(object as AntiPattern).riskLevel.toUpperCase()} />
                )}
                <MetaRow
                  icon={<Calendar className="h-3.5 w-3.5" />}
                  label="Created"
                  value={new Date(getCreatedAt(object)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                />
                <MetaRow
                  icon={<Link2 className="h-3.5 w-3.5" />}
                  label="ID"
                  value={`${type.replace("_", "-")}:${(object as Principle).id}`}
                />
              </div>
            </SheetHeader>

            <div className="px-6 py-5 flex-1">
              {type === "principle" && <PrincipleDetail obj={object as Principle} />}
              {type === "rule" && <RuleDetail obj={object as Rule} />}
              {type === "anti_pattern" && <AntiPatternDetail obj={object as AntiPattern} />}
              {type === "playbook" && <PlaybookDetail obj={object as Playbook} />}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
