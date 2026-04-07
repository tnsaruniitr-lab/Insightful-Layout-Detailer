import { useState, useRef, useCallback, useEffect } from "react";
import { Layout } from "@/components/layout";
import { useBrandContext } from "@/hooks/use-brand-context";
import {
  useListDocuments,
  useUploadDocument,
  useProcessDocument,
  getDocument,
  getGetDocumentQueryKey,
  DocumentDomainTag,
  DocumentRawTextStatus,
  UploadDocumentFormSourceType,
  UploadDocumentFormDomainTag,
  UploadDocumentFormTrustLevel,
  Document,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { FileText, Upload, RefreshCw, AlertCircle, CheckCircle2, Clock, Database, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 30;

const INGESTION_STEPS = [
  "extracting_text",
  "chunking_document",
  "embedding_chunks",
  "classifying_chunks",
  "extracting_principles",
  "extracting_rules",
  "extracting_playbooks",
  "extracting_anti_patterns",
  "deduplicating",
];

function getProgressInfo(doc: Document): { percent: number; label: string } {
  const msg = doc.errorMessage ?? "";
  if (doc.rawTextStatus === "done") return { percent: 100, label: "Processing complete" };
  if (doc.rawTextStatus === "error") return { percent: 0, label: "Processing failed" };
  if (msg.startsWith("progress:")) {
    const step = msg.replace("progress:", "");
    const idx = INGESTION_STEPS.indexOf(step);
    const percent = idx >= 0 ? Math.round(((idx + 1) / INGESTION_STEPS.length) * 95) : 10;
    const label = step.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    return { percent, label };
  }
  return { percent: 5, label: "Starting..." };
}

interface PollingState {
  docId: number;
  polls: number;
  timedOut: boolean;
}

export default function KnowledgeHub() {
  const { activeBrandId } = useBrandContext();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [domainFilter, setDomainFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [pollingState, setPollingState] = useState<PollingState | null>(null);
  const [processingDocId, setProcessingDocId] = useState<number | null>(null);

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [domainTag, setDomainTag] = useState<UploadDocumentFormDomainTag>(UploadDocumentFormDomainTag.general);
  const [sourceType, setSourceType] = useState<UploadDocumentFormSourceType>(UploadDocumentFormSourceType.text);
  const [trustLevel, setTrustLevel] = useState<UploadDocumentFormTrustLevel>(UploadDocumentFormTrustLevel.high);

  const listParams = {
    ...(domainFilter !== "all" ? { domain_tag: domainFilter as DocumentDomainTag } : {}),
    ...(statusFilter !== "all" ? { status: statusFilter as DocumentRawTextStatus } : {}),
  };

  const { data: documents, isLoading: docsLoading, isError: docsError, refetch: refetchDocs } = useListDocuments(listParams);

  const uploadDoc = useUploadDocument();
  const processDoc = useProcessDocument();

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  const startPolling = useCallback(
    (docId: number) => {
      let pollCount = 0;
      setPollingState({ docId, polls: 0, timedOut: false });

      pollTimerRef.current = setInterval(async () => {
        pollCount++;
        setPollingState((prev) => prev ? { ...prev, polls: pollCount } : null);

        try {
          const doc = await getDocument(docId);
          queryClient.setQueryData(getGetDocumentQueryKey(docId), doc);

          if (doc.rawTextStatus === "done") {
            stopPolling();
            setPollingState(null);
            setProcessingDocId(null);
            queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
            toast({ title: "Document processed and indexed successfully" });
            return;
          }

          if (doc.rawTextStatus === "error") {
            stopPolling();
            setPollingState(null);
            setProcessingDocId(null);
            queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
            toast({
              title: "Document processing failed",
              description: doc.errorMessage ?? "Unknown error",
              variant: "destructive",
            });
            return;
          }

          if (pollCount >= MAX_POLLS) {
            stopPolling();
            setPollingState((prev) => prev ? { ...prev, timedOut: true } : null);
            setProcessingDocId(null);
            queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
          }
        } catch {
          // Keep polling on transient errors
        }
      }, POLL_INTERVAL_MS);
    },
    [queryClient, stopPolling, toast]
  );

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !title) return;

    try {
      const uploaded = await uploadDoc.mutateAsync({
        data: {
          file,
          title,
          domainTag,
          sourceType,
          trustLevel,
          brandId: activeBrandId ?? undefined,
        },
      });

      setIsUploadOpen(false);
      setFile(null);
      setTitle("");
      setProcessingDocId(uploaded.id);
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });

      await processDoc.mutateAsync({ id: uploaded.id });
      startPolling(uploaded.id);
    } catch {
      toast({ title: "Failed to upload document", variant: "destructive" });
    }
  };

  const handleProcess = async (id: number) => {
    try {
      setProcessingDocId(id);
      await processDoc.mutateAsync({ id });
      startPolling(id);
    } catch {
      setProcessingDocId(null);
      toast({ title: "Failed to start processing", variant: "destructive" });
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "done": return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
      case "processing": return <RefreshCw className="h-4 w-4 text-blue-500 animate-spin" />;
      case "error": return <AlertCircle className="h-4 w-4 text-destructive" />;
      default: return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusBadgeVariant = (status: string) => {
    if (status === "done") return "secondary";
    if (status === "error") return "destructive";
    return "default";
  };

  return (
    <Layout>
      <div className="space-y-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Knowledge Hub</h1>
            <p className="text-muted-foreground">Manage and ingest source documents for the intelligence engine.</p>
          </div>
          <Dialog open={isUploadOpen} onOpenChange={setIsUploadOpen}>
            <DialogTrigger asChild>
              <Button>
                <Upload className="h-4 w-4 mr-2" />
                Upload Source
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Upload Knowledge Source</DialogTitle>
                <DialogDescription>
                  Ingest a new document into the intelligence engine. PDF, text, and markdown files are supported.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleUpload} className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="file">File (PDF, TXT, MD, DOC)</Label>
                  <Input
                    id="file"
                    type="file"
                    accept=".pdf,.txt,.md,.doc,.docx"
                    onChange={(e) => {
                      const f = e.target.files?.[0] || null;
                      setFile(f);
                      if (f) {
                        const ext = f.name.split(".").pop()?.toLowerCase();
                        if (ext === "pdf") setSourceType(UploadDocumentFormSourceType.pdf);
                        else if (ext === "md") setSourceType(UploadDocumentFormSourceType.markdown);
                        else if (ext === "doc" || ext === "docx") setSourceType(UploadDocumentFormSourceType.doc);
                        else setSourceType(UploadDocumentFormSourceType.text);
                      }
                    }}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="title">Document Title</Label>
                  <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. GEO Optimization Playbook 2024" required />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Domain</Label>
                    <Select value={domainTag} onValueChange={(v) => setDomainTag(v as UploadDocumentFormDomainTag)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.values(UploadDocumentFormDomainTag).map((tag) => (
                          <SelectItem key={tag} value={tag}>{tag.toUpperCase()}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Source Type</Label>
                    <Select value={sourceType} onValueChange={(v) => setSourceType(v as UploadDocumentFormSourceType)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.values(UploadDocumentFormSourceType).map((t) => (
                          <SelectItem key={t} value={t}>{t.replace("_", " ").toUpperCase()}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Trust Level</Label>
                  <Select value={trustLevel} onValueChange={(v) => setTrustLevel(v as UploadDocumentFormTrustLevel)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.values(UploadDocumentFormTrustLevel).map((level) => (
                        <SelectItem key={level} value={level}>{level}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={!file || !title || uploadDoc.isPending || processDoc.isPending}>
                    {uploadDoc.isPending || processDoc.isPending ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Uploading...</>
                    ) : (
                      "Upload & Process"
                    )}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {pollingState && (
          <Card className={`border-blue-200 bg-blue-50/50 ${pollingState.timedOut ? "border-amber-200 bg-amber-50/50" : ""}`}>
            <CardContent className="p-4">
              {pollingState.timedOut ? (
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium text-amber-800">Processing is taking longer than expected</p>
                    <p className="text-sm text-amber-700 mt-1">The document is still being processed. Check back in a few minutes — reload the page to see the updated status.</p>
                  </div>
                </div>
              ) : (() => {
                const doc = documents?.find((d) => d.id === pollingState.docId);
                const progress = doc ? getProgressInfo(doc) : { percent: 10, label: "Queued for processing" };
                return (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2 font-medium text-blue-800">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Processing document...
                      </div>
                      <span className="text-blue-600 font-mono text-xs">
                        {pollingState.polls}/{MAX_POLLS} polls
                      </span>
                    </div>
                    <Progress value={progress.percent} className="h-1.5" />
                    <p className="text-xs text-blue-700">{progress.label}</p>
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        )}

        <div className="flex gap-4 items-center bg-muted/30 p-2 rounded-lg border">
          <div className="flex-1 flex gap-2">
            <Select value={domainFilter} onValueChange={setDomainFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by Domain" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Domains</SelectItem>
                {Object.values(DocumentDomainTag).map((tag) => (
                  <SelectItem key={tag} value={tag}>{tag.toUpperCase()}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {Object.values(DocumentRawTextStatus).map((status) => (
                  <SelectItem key={status} value={status}>{status}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <span className="text-xs text-muted-foreground font-mono pr-2">
            {documents?.length ?? 0} document{(documents?.length ?? 0) !== 1 ? "s" : ""}
          </span>
        </div>

        <Card>
          <CardContent className="p-0">
            {docsLoading ? (
              <div className="p-8 text-center text-muted-foreground">Loading documents...</div>
            ) : docsError ? (
              <div className="p-8 text-center space-y-3">
                <AlertCircle className="h-8 w-8 text-destructive mx-auto" />
                <p className="text-sm font-medium text-destructive">Failed to load documents</p>
                <Button variant="outline" size="sm" onClick={() => refetchDocs()}>
                  <RefreshCw className="h-3.5 w-3.5 mr-2" />
                  Retry
                </Button>
              </div>
            ) : documents && documents.length > 0 ? (
              <div className="divide-y">
                {documents.map((doc) => {
                  const isPolling = pollingState?.docId === doc.id && !pollingState.timedOut;
                  const progress = isPolling ? getProgressInfo(doc) : null;

                  return (
                    <div key={doc.id} className="p-4 flex items-start justify-between hover:bg-muted/20 transition-colors">
                      <div className="flex items-start gap-4 flex-1 min-w-0">
                        <div className="mt-1 h-10 w-10 bg-primary/10 rounded flex items-center justify-center text-primary shrink-0">
                          <FileText className="h-5 w-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-semibold text-base truncate">{doc.title}</h4>
                          <div className="flex flex-wrap items-center gap-2 mt-1 text-sm text-muted-foreground">
                            <Badge variant="secondary" className="text-xs font-mono uppercase">{doc.domainTag}</Badge>
                            <Badge variant="outline" className="text-xs">{doc.trustLevel}</Badge>
                            <span className="capitalize text-xs">{doc.sourceType.replace("_", " ")}</span>
                            <span className="text-xs">•</span>
                            <span className="text-xs">{new Date(doc.createdAt).toLocaleDateString()}</span>
                          </div>
                          {isPolling && progress && (
                            <div className="mt-2 space-y-1">
                              <Progress value={progress.percent} className="h-1" />
                              <p className="text-xs text-blue-600">{progress.label}</p>
                            </div>
                          )}
                          {doc.rawTextStatus === "error" && doc.errorMessage && !doc.errorMessage.startsWith("progress:") && (
                            <p className="text-xs text-destructive mt-1 flex items-center gap-1">
                              <AlertCircle className="h-3 w-3 shrink-0" />
                              {doc.errorMessage}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 ml-4 shrink-0">
                        <Badge
                          variant={getStatusBadgeVariant(doc.rawTextStatus) as "default" | "secondary" | "destructive" | "outline"}
                          className="flex items-center gap-1.5 px-3 py-1"
                        >
                          {getStatusIcon(doc.rawTextStatus)}
                          <span className="capitalize">{doc.rawTextStatus}</span>
                        </Badge>
                        {(doc.rawTextStatus === "pending" || doc.rawTextStatus === "error") && processingDocId !== doc.id && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleProcess(doc.id)}
                            disabled={processDoc.isPending || !!pollingState}
                          >
                            <RefreshCw className="h-4 w-4 mr-2" />
                            Process
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-16 text-center text-muted-foreground flex flex-col items-center justify-center">
                <Database className="h-12 w-12 text-muted-foreground/30 mb-4" />
                <h3 className="text-lg font-semibold text-foreground">No documents uploaded yet</h3>
                <p className="text-sm mt-1">Start by uploading a knowledge source — PDF, text, or markdown files are supported.</p>
                <Button className="mt-6" onClick={() => setIsUploadOpen(true)}>
                  <Upload className="h-4 w-4 mr-2" />
                  Upload Your First Document
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
