import { useState } from "react";
import { Layout } from "@/components/layout";
import { useBrandContext } from "@/hooks/use-brand-context";
import { 
  useListDocuments, 
  useUploadDocument, 
  useProcessDocument,
  DocumentDomainTag,
  DocumentRawTextStatus,
  UploadDocumentFormSourceType,
  UploadDocumentFormDomainTag,
  UploadDocumentFormTrustLevel
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { FileText, Upload, RefreshCw, AlertCircle, CheckCircle2, Clock, Database } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

export default function KnowledgeHub() {
  const { activeBrandId } = useBrandContext();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [domainFilter, setDomainFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [isUploadOpen, setIsUploadOpen] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [domainTag, setDomainTag] = useState<UploadDocumentFormDomainTag>(UploadDocumentFormDomainTag.general);
  const [sourceType, setSourceType] = useState<UploadDocumentFormSourceType>(UploadDocumentFormSourceType.pdf);
  const [trustLevel, setTrustLevel] = useState<UploadDocumentFormTrustLevel>(UploadDocumentFormTrustLevel.high);

  const listParams = {
    ...(activeBrandId ? { brand_id: activeBrandId } : {}),
    ...(domainFilter !== "all" ? { domain_tag: domainFilter as DocumentDomainTag } : {}),
    ...(statusFilter !== "all" ? { status: statusFilter as DocumentRawTextStatus } : {})
  };

  const { data: documents, isLoading: docsLoading } = useListDocuments(listParams, { query: { enabled: true } });
  
  const uploadDoc = useUploadDocument();
  const processDoc = useProcessDocument();

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !title) return;

    try {
      await uploadDoc.mutateAsync({
        data: {
          file,
          title,
          domainTag,
          sourceType,
          trustLevel,
          brandId: activeBrandId || undefined
        }
      });
      toast({ title: "Document uploaded successfully" });
      setIsUploadOpen(false);
      setFile(null);
      setTitle("");
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
    } catch (error) {
      toast({ title: "Failed to upload document", variant: "destructive" });
    }
  };

  const handleProcess = async (id: number) => {
    try {
      await processDoc.mutateAsync({ id });
      toast({ title: "Processing started" });
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
    } catch (error) {
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
                  Ingest a new document into the intelligence engine.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleUpload} className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="file">File</Label>
                  <Input id="file" type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="title">Title</Label>
                  <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Domain</Label>
                    <Select value={domainTag} onValueChange={(v) => setDomainTag(v as UploadDocumentFormDomainTag)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.values(UploadDocumentFormDomainTag).map(tag => (
                          <SelectItem key={tag} value={tag}>{tag}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Type</Label>
                    <Select value={sourceType} onValueChange={(v) => setSourceType(v as UploadDocumentFormSourceType)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.values(UploadDocumentFormSourceType).map(type => (
                          <SelectItem key={type} value={type}>{type}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={!file || !title || uploadDoc.isPending}>
                    {uploadDoc.isPending ? "Uploading..." : "Upload Document"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <div className="flex gap-4 items-center bg-muted/30 p-2 rounded-lg border">
          <div className="flex-1 flex gap-2">
            <Select value={domainFilter} onValueChange={setDomainFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by Domain" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Domains</SelectItem>
                {Object.values(DocumentDomainTag).map(tag => (
                  <SelectItem key={tag} value={tag}>{tag}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {Object.values(DocumentRawTextStatus).map(status => (
                  <SelectItem key={status} value={status}>{status}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            {docsLoading ? (
              <div className="p-8 text-center text-muted-foreground">Loading documents...</div>
            ) : documents && documents.length > 0 ? (
              <div className="divide-y">
                {documents.map((doc) => (
                  <div key={doc.id} className="p-4 flex items-center justify-between hover:bg-muted/20 transition-colors">
                    <div className="flex items-start gap-4">
                      <div className="mt-1 h-10 w-10 bg-primary/10 rounded flex items-center justify-center text-primary">
                        <FileText className="h-5 w-5" />
                      </div>
                      <div>
                        <h4 className="font-semibold text-base">{doc.title}</h4>
                        <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                          <Badge variant="secondary" className="text-xs font-mono">{doc.domainTag}</Badge>
                          <span className="capitalize">{doc.sourceType.replace("_", " ")}</span>
                          <span>•</span>
                          <span>{new Date(doc.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2 px-3 py-1 bg-muted rounded-full text-sm font-medium">
                        {getStatusIcon(doc.rawTextStatus)}
                        <span className="capitalize">{doc.rawTextStatus}</span>
                      </div>
                      {doc.rawTextStatus === "pending" || doc.rawTextStatus === "error" ? (
                        <Button 
                          variant="outline" 
                          size="sm" 
                          onClick={() => handleProcess(doc.id)}
                          disabled={processDoc.isPending}
                        >
                          <RefreshCw className="h-4 w-4 mr-2" />
                          Process
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-12 text-center text-muted-foreground flex flex-col items-center justify-center">
                <Database className="h-12 w-12 text-muted-foreground/30 mb-4" />
                <h3 className="text-lg font-medium text-foreground">No documents found</h3>
                <p>Upload some knowledge sources to begin analysis.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
