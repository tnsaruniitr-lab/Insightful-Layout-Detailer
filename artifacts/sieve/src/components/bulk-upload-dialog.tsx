import { useState, useCallback, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { UploadDocumentFormDomainTag, UploadDocumentFormTrustLevel } from "@workspace/api-client-react";
import { Upload, CheckCircle2, AlertCircle, Loader2, X, FileText, Sparkles } from "lucide-react";

const CONCURRENCY = 5;
const MAX_POLLS = 50;
const POLL_MS = 3000;

const TIER_LABELS: Record<string, string> = {
  tier1: "Tier 1",
  tier2: "Tier 2",
  tier3: "Tier 3",
};
const TIER_COLORS: Record<string, string> = {
  tier1: "bg-emerald-100 text-emerald-800",
  tier2: "bg-blue-100 text-blue-800",
  tier3: "bg-slate-100 text-slate-600",
};
const TIER_TO_TRUST: Record<string, UploadDocumentFormTrustLevel> = {
  tier1: UploadDocumentFormTrustLevel.high,
  tier2: UploadDocumentFormTrustLevel.medium,
  tier3: UploadDocumentFormTrustLevel.low,
};

interface BulkItem {
  id: string;
  file: File;
  title: string;
  sourceUrl: string;
  domainTag: UploadDocumentFormDomainTag;
  trustLevel: UploadDocumentFormTrustLevel;
  trustLevelOverridden: boolean;
  autoTier?: string;
  autoOrg?: string;
  classifying: boolean;
  status: "pending" | "uploading" | "processing" | "done" | "error";
  percent: number;
  progressLabel: string;
  error?: string;
}

function getSourceType(file: File): string {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return "pdf";
  if (ext === "md") return "markdown";
  if (ext === "doc" || ext === "docx") return "doc";
  return "text";
}

function statusIcon(status: BulkItem["status"], classifying: boolean) {
  if (classifying) return <Loader2 className="h-4 w-4 text-muted-foreground animate-spin shrink-0" />;
  if (status === "done") return <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />;
  if (status === "error") return <AlertCircle className="h-4 w-4 text-destructive shrink-0" />;
  if (status === "uploading" || status === "processing") return <Loader2 className="h-4 w-4 text-blue-500 animate-spin shrink-0" />;
  return <FileText className="h-4 w-4 text-muted-foreground shrink-0" />;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
  activeBrandId?: number | null;
}

export function BulkUploadDialog({ open, onOpenChange, onComplete, activeBrandId }: Props) {
  const [items, setItems] = useState<BulkItem[]>([]);
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);
  const [droppedCount, setDroppedCount] = useState(0);

  const updateItem = useCallback((id: string, updates: Partial<BulkItem>) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...updates } : item)));
  }, []);

  const classifyItem = useCallback(async (id: string, title: string, sourceUrl?: string) => {
    const base = (import.meta.env.BASE_URL ?? "").replace(/\/$/, "");
    updateItem(id, { classifying: true });
    try {
      const params = new URLSearchParams({ title });
      if (sourceUrl) params.set("sourceUrl", sourceUrl);
      const res = await fetch(`${base}/api/documents/pre-classify?${params.toString()}`);
      if (!res.ok) throw new Error("classify failed");
      const data = await res.json() as { sourceOrg: string; tier: string; trustLevel: string };
      setItems((prev) => prev.map((item) => {
        if (item.id !== id) return item;
        const detectedTrust = TIER_TO_TRUST[data.tier] ?? UploadDocumentFormTrustLevel.medium;
        return {
          ...item,
          autoTier: data.tier,
          autoOrg: data.sourceOrg,
          classifying: false,
          trustLevel: item.trustLevelOverridden ? item.trustLevel : detectedTrust,
        };
      }));
    } catch {
      updateItem(id, { classifying: false });
    }
  }, [updateItem]);

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    const all = Array.from(files);
    const capped = all.slice(0, 50);
    const dropped = all.length - capped.length;
    setDroppedCount(dropped > 0 ? dropped : 0);
    const newItems: BulkItem[] = capped.map((file) => ({
      id: `${Date.now()}-${Math.random()}`,
      file,
      title: file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "),
      sourceUrl: "",
      domainTag: UploadDocumentFormDomainTag.general,
      trustLevel: UploadDocumentFormTrustLevel.high,
      trustLevelOverridden: false,
      classifying: false,
      status: "pending",
      percent: 0,
      progressLabel: "Queued",
    }));
    setItems((prev) => [...prev, ...newItems]);
    for (const item of newItems) {
      classifyItem(item.id, item.title);
    }
  };

  const handleTitleBlur = (id: string, title: string) => {
    const item = items.find((i) => i.id === id);
    if (!item || !title.trim()) return;
    classifyItem(id, title.trim(), item.sourceUrl || undefined);
  };

  const handleSourceUrlBlur = (id: string, sourceUrl: string) => {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    classifyItem(id, item.title, sourceUrl || undefined);
  };

  const removeItem = (id: string) => {
    if (running) return;
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const processItem = useCallback(async (item: BulkItem) => {
    const base = (import.meta.env.BASE_URL ?? "").replace(/\/$/, "");

    updateItem(item.id, { status: "uploading", percent: 10, progressLabel: "Uploading file..." });

    try {
      const form = new FormData();
      form.append("file", item.file);
      form.append("title", item.title);
      form.append("domainTag", item.domainTag);
      form.append("trustLevel", item.trustLevel);
      form.append("sourceType", getSourceType(item.file));
      if (item.sourceUrl) form.append("sourceUrl", item.sourceUrl);
      if (activeBrandId) form.append("brandId", String(activeBrandId));

      const uploadRes = await fetch(`${base}/api/documents/upload`, { method: "POST", body: form });
      if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.status}`);
      const doc = await uploadRes.json();

      updateItem(item.id, { status: "processing", percent: 20, progressLabel: "Starting processing..." });

      await fetch(`${base}/api/documents/${doc.id}/process`, { method: "POST" });

      const STEPS: Record<string, number> = {
        extracting_text: 30,
        chunking_document: 45,
        embedding_chunks: 60,
        classifying_chunks: 70,
        extracting_intelligence: 80,
        deduplicating: 92,
      };

      for (let poll = 0; poll < MAX_POLLS; poll++) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const res = await fetch(`${base}/api/documents/${doc.id}`);
        const fresh = await res.json();

        if (fresh.rawTextStatus === "done") {
          updateItem(item.id, { status: "done", percent: 100, progressLabel: "Complete" });
          return;
        }
        if (fresh.rawTextStatus === "error") {
          throw new Error(fresh.errorMessage?.replace("progress:", "") || "Processing failed");
        }
        const msg: string = fresh.errorMessage ?? "";
        if (msg.startsWith("progress:")) {
          const step = msg.replace("progress:", "");
          const pct = STEPS[step] ?? 75;
          const label = step.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
          updateItem(item.id, { percent: pct, progressLabel: label });
        }
      }
      throw new Error("Processing timed out");
    } catch (err) {
      updateItem(item.id, {
        status: "error",
        percent: 0,
        progressLabel: "",
        error: err instanceof Error ? err.message : "Failed",
      });
    }
  }, [updateItem, activeBrandId]);

  const startBulkUpload = async () => {
    setRunning(true);
    setStarted(true);

    const queue = items.filter((i) => i.status === "pending");
    const remaining = [...queue];

    const worker = async (): Promise<void> => {
      while (remaining.length > 0) {
        const item = remaining.shift();
        if (!item) break;
        await processItem(item);
      }
    };

    const slots = Math.min(CONCURRENCY, queue.length);
    await Promise.all(Array.from({ length: slots }, worker));

    setRunning(false);
    onComplete();
  };

  const reset = () => {
    if (running) return;
    setItems([]);
    setStarted(false);
    setDroppedCount(0);
  };

  const doneCount = items.filter((i) => i.status === "done").length;
  const errorCount = items.filter((i) => i.status === "error").length;
  const allDone = started && !running;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!running) { onOpenChange(o); if (!o) reset(); } }}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" /> Bulk Upload
          </DialogTitle>
          <DialogDescription>
            Upload up to 30 documents. Authority tier is auto-detected from filename and URL — you can override per row.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-3 py-2 min-h-0">
          {!started && (
            <>
              <label className="flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-8 cursor-pointer hover:border-primary/50 hover:bg-muted/20 transition-colors">
                <Upload className="h-8 w-8 text-muted-foreground mb-2" />
                <span className="text-sm font-medium">Click to select files</span>
                <span className="text-xs text-muted-foreground mt-1">PDF, TXT, MD, DOC — up to 30 files</span>
                <input
                  type="file"
                  className="hidden"
                  multiple
                  accept=".pdf,.txt,.md,.doc,.docx"
                  onChange={(e) => handleFiles(e.target.files)}
                />
              </label>
              {droppedCount > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-xs">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  {droppedCount} file{droppedCount !== 1 ? "s" : ""} not added — limit is 50.
                </div>
              )}
            </>
          )}

          {items.length > 0 && (
            <div className="space-y-2">
              {items.map((item) => (
                <div key={item.id} className="border rounded-lg p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <div className="mt-1">{statusIcon(item.status, item.classifying && item.status === "pending")}</div>
                    <div className="flex-1 min-w-0 space-y-1.5">
                      {started ? (
                        <span className="font-medium text-sm truncate block">{item.title}</span>
                      ) : (
                        <Input
                          value={item.title}
                          onChange={(e) => setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, title: e.target.value } : i))}
                          onBlur={(e) => handleTitleBlur(item.id, e.target.value)}
                          className="h-7 text-sm"
                          placeholder="Document title"
                        />
                      )}
                      {!started && (
                        <Input
                          value={item.sourceUrl}
                          onChange={(e) => setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, sourceUrl: e.target.value } : i))}
                          onBlur={(e) => handleSourceUrlBlur(item.id, e.target.value)}
                          className="h-6 text-xs text-muted-foreground"
                          placeholder="Source URL (optional — improves tier detection)"
                        />
                      )}
                    </div>

                    {!started && (
                      <div className="flex items-center gap-1 shrink-0">
                        <Select
                          value={item.domainTag}
                          onValueChange={(v) => setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, domainTag: v as UploadDocumentFormDomainTag } : i))}
                        >
                          <SelectTrigger className="h-7 w-[80px] text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {Object.values(UploadDocumentFormDomainTag).map((t) => (
                              <SelectItem key={t} value={t} className="text-xs">{t.toUpperCase()}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select
                          value={item.trustLevel}
                          onValueChange={(v) => setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, trustLevel: v as UploadDocumentFormTrustLevel, trustLevelOverridden: true } : i))}
                        >
                          <SelectTrigger className="h-7 w-[80px] text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="high" className="text-xs">Tier 1</SelectItem>
                            <SelectItem value="medium" className="text-xs">Tier 2</SelectItem>
                            <SelectItem value="low" className="text-xs">Tier 3</SelectItem>
                          </SelectContent>
                        </Select>
                        <button onClick={() => removeItem(item.id)} className="text-muted-foreground hover:text-destructive p-1">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}

                    {started && (
                      <Badge
                        variant={item.status === "done" ? "secondary" : item.status === "error" ? "destructive" : "default"}
                        className="text-[10px] shrink-0"
                      >
                        {item.status}
                      </Badge>
                    )}
                  </div>

                  {!started && item.autoTier && (
                    <div className="flex items-center gap-1.5 ml-6">
                      <Sparkles className="h-3 w-3 text-muted-foreground" />
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${TIER_COLORS[item.autoTier] ?? "bg-slate-100 text-slate-600"}`}>
                        {TIER_LABELS[item.autoTier] ?? item.autoTier}
                      </span>
                      {item.autoOrg && item.autoOrg !== "Unknown" && (
                        <span className="text-[10px] text-muted-foreground">{item.autoOrg}</span>
                      )}
                      {item.trustLevelOverridden && (
                        <span className="text-[10px] text-amber-600">(overridden)</span>
                      )}
                    </div>
                  )}

                  {(item.status === "uploading" || item.status === "processing") && (
                    <div className="space-y-1">
                      <Progress value={item.percent} className="h-1" />
                      <p className="text-[10px] text-blue-600">{item.progressLabel}</p>
                    </div>
                  )}
                  {item.status === "error" && (
                    <p className="text-[10px] text-destructive flex items-center gap-1">
                      <AlertCircle className="h-3 w-3 shrink-0" /> {item.error}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {allDone && (
            <div className={`text-center py-3 rounded-lg text-sm font-medium ${errorCount === 0 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
              {doneCount} of {items.length} documents processed{errorCount > 0 ? ` (${errorCount} failed)` : " successfully"}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 pt-2 border-t">
          {!started && (
            <>
              <Button variant="outline" onClick={() => { onOpenChange(false); reset(); }}>Cancel</Button>
              <Button onClick={startBulkUpload} disabled={items.length === 0 || items.every((i) => !i.title.trim()) || items.some((i) => i.classifying)}>
                <Upload className="h-4 w-4 mr-2" />
                Upload {items.length > 0 ? `${items.length} Document${items.length !== 1 ? "s" : ""}` : "Documents"}
              </Button>
            </>
          )}
          {running && (
            <Button disabled>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Processing {doneCount}/{items.length}...
            </Button>
          )}
          {allDone && (
            <Button onClick={() => { onOpenChange(false); reset(); }}>
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
