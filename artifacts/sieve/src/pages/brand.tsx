import { useState, useEffect } from "react";
import { Layout } from "@/components/layout";
import { useBrandContext } from "@/hooks/use-brand-context";
import {
  useGetBrand, useUpdateBrand, useCreateBrand,
  useGetBrandCompetitors, useCreateCompetitor, useDeleteCompetitor,
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Trash2, Plus, Save, X, PlusCircle, Pencil, AlertCircle, RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

function TagInput({
  label, description, values, onChange, placeholder,
}: { label: string; description?: string; values: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [input, setInput] = useState("");

  const addTag = () => {
    const trimmed = input.trim();
    if (trimmed && !values.includes(trimmed)) {
      onChange([...values, trimmed]);
    }
    setInput("");
  };

  const removeTag = (t: string) => onChange(values.filter((v) => v !== t));

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
          className="flex-1"
        />
        <Button type="button" variant="outline" size="icon" onClick={addTag} disabled={!input.trim()}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {values.map((t) => (
            <Badge key={t} variant="secondary" className="pl-2.5 pr-1.5 py-0.5 gap-1 text-xs">
              {t}
              <button onClick={() => removeTag(t)} className="hover:text-destructive transition-colors">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function EditCompetitorDialog({ open, onClose, competitor, brandId, onSaved }: {
  open: boolean; onClose: () => void;
  competitor: { id: number; name: string; notes?: string | null };
  brandId: number;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const deleteCompetitor = useDeleteCompetitor();
  const createCompetitor = useCreateCompetitor();
  const [name, setName] = useState(competitor.name);
  const [notes, setNotes] = useState(competitor.notes ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => { setName(competitor.name); setNotes(competitor.notes ?? ""); }, [competitor]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await deleteCompetitor.mutateAsync({ id: brandId, competitorId: competitor.id });
      await createCompetitor.mutateAsync({ id: brandId, data: { name: name.trim(), notes: notes || undefined } });
      toast({ title: "Competitor updated" });
      onSaved();
    } catch {
      toast({ title: "Failed to update competitor", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit Competitor</DialogTitle></DialogHeader>
        <form onSubmit={handleSave} className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label>Competitor Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label>Notes / Positioning</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Price leader..." />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!name.trim() || saving}>{saving ? "Saving..." : "Save Changes"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreateBrandDialog({ open, onClose, onCreated }: {
  open: boolean; onClose: () => void; onCreated: (id: number) => void;
}) {
  const createBrand = useCreateBrand();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [icp, setIcp] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const brand = await createBrand.mutateAsync({ data: { name: name.trim(), icpDescription: icp } });
      toast({ title: "Brand created", description: brand.name });
      onCreated(brand.id);
      setName(""); setIcp("");
    } catch {
      toast({ title: "Failed to create brand", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New Brand</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label>Brand Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Corp" required />
          </div>
          <div className="space-y-2">
            <Label>ICP Description</Label>
            <Textarea rows={3} value={icp} onChange={(e) => setIcp(e.target.value)} placeholder="Describe your target audience..." />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!name.trim() || createBrand.isPending}>
              {createBrand.isPending ? "Creating..." : "Create Brand"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function parseJsonList(val?: string | null): string[] {
  if (!val) return [];
  try { const p = JSON.parse(val); return Array.isArray(p) ? p : []; } catch { return []; }
}

export default function BrandProfile() {
  const { activeBrandId, setActiveBrandId } = useBrandContext();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const { data: brand, isLoading: brandLoading, isError: brandError, refetch: refetchBrand } = useGetBrand(activeBrandId || 0, {
    query: { enabled: !!activeBrandId, queryKey: ["brands", activeBrandId] },
  });
  const { data: competitors, isLoading: competitorsLoading, isError: competitorsError, refetch: refetchCompetitors } = useGetBrandCompetitors(activeBrandId || 0, {
    query: { enabled: !!activeBrandId, queryKey: ["brands", activeBrandId, "competitors"] },
  });

  const updateBrand = useUpdateBrand();
  const createCompetitor = useCreateCompetitor();
  const deleteCompetitor = useDeleteCompetitor();

  const [formData, setFormData] = useState({
    name: "",
    icpDescription: "",
    positioningStatement: "",
    targetGeographies: [] as string[],
    productTruths: [] as string[],
    toneDescriptors: [] as string[],
  });

  const [newCompName, setNewCompName] = useState("");
  const [newCompNotes, setNewCompNotes] = useState("");
  const [editingCompetitor, setEditingCompetitor] = useState<{ id: number; name: string; notes?: string | null } | null>(null);

  useEffect(() => {
    if (brand) {
      setFormData({
        name: brand.name || "",
        icpDescription: brand.icpDescription || "",
        positioningStatement: brand.positioningStatement || "",
        targetGeographies: parseJsonList(brand.targetGeographiesJson),
        productTruths: parseJsonList(brand.productTruthsJson),
        toneDescriptors: parseJsonList(brand.toneDescriptorsJson),
      });
    }
  }, [brand]);

  const handleSaveBrand = async () => {
    if (!activeBrandId) return;
    try {
      await updateBrand.mutateAsync({
        id: activeBrandId,
        data: {
          name: formData.name,
          icpDescription: formData.icpDescription,
          positioningStatement: formData.positioningStatement,
          targetGeographiesJson: JSON.stringify(formData.targetGeographies),
          productTruthsJson: JSON.stringify(formData.productTruths),
          toneDescriptorsJson: JSON.stringify(formData.toneDescriptors),
        },
      });
      toast({ title: "Brand profile updated" });
      queryClient.invalidateQueries({ queryKey: ["brands", activeBrandId] });
    } catch {
      toast({ title: "Failed to update brand", variant: "destructive" });
    }
  };

  const handleAddCompetitor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeBrandId || !newCompName) return;
    try {
      await createCompetitor.mutateAsync({ id: activeBrandId, data: { name: newCompName, notes: newCompNotes } });
      setNewCompName(""); setNewCompNotes("");
      toast({ title: "Competitor added" });
      queryClient.invalidateQueries({ queryKey: ["brands", activeBrandId, "competitors"] });
    } catch {
      toast({ title: "Failed to add competitor", variant: "destructive" });
    }
  };

  const handleDeleteCompetitor = async (competitorId: number) => {
    if (!activeBrandId) return;
    try {
      await deleteCompetitor.mutateAsync({ id: activeBrandId, competitorId });
      toast({ title: "Competitor removed" });
      queryClient.invalidateQueries({ queryKey: ["brands", activeBrandId, "competitors"] });
    } catch {
      toast({ title: "Failed to remove competitor", variant: "destructive" });
    }
  };

  if (!activeBrandId) {
    return (
      <Layout>
        <div className="max-w-4xl mx-auto py-16 text-center space-y-4">
          <h1 className="text-3xl font-bold">Brand Profile</h1>
          <p className="text-muted-foreground">No active brand. Create one to get started.</p>
          <Button onClick={() => setShowCreate(true)}>
            <PlusCircle className="h-4 w-4 mr-2" />Create Brand
          </Button>
          <CreateBrandDialog open={showCreate} onClose={() => setShowCreate(false)} onCreated={(id) => { setActiveBrandId(id); setShowCreate(false); }} />
        </div>
      </Layout>
    );
  }

  if (brandError || competitorsError) {
    return (
      <Layout>
        <div className="max-w-4xl mx-auto py-16 text-center space-y-4">
          <AlertCircle className="h-12 w-12 text-destructive mx-auto" />
          <h2 className="text-xl font-semibold">Failed to load brand data</h2>
          <p className="text-muted-foreground text-sm">
            {brandError ? "Could not load brand profile." : "Could not load competitors."} Please try again.
          </p>
          <Button variant="outline" onClick={() => { void refetchBrand(); void refetchCompetitors(); }}>
            <RefreshCw className="h-4 w-4 mr-2" />Retry
          </Button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-8 max-w-4xl mx-auto">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Brand Profile</h1>
            <p className="text-muted-foreground">Configure the core identity and positioning for {brand?.name ?? "your brand"}.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowCreate(true)}>
            <PlusCircle className="h-4 w-4 mr-2" />New Brand
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Core Identity</CardTitle>
            <CardDescription>Foundation details used by the intelligence engine for context.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label>Brand Name</Label>
              <Input value={formData.name} onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Ideal Customer Profile (ICP)</Label>
              <Textarea
                rows={4}
                value={formData.icpDescription}
                onChange={(e) => setFormData((p) => ({ ...p, icpDescription: e.target.value }))}
                placeholder="Describe your target audience..."
              />
            </div>
            <div className="space-y-2">
              <Label>Positioning Statement</Label>
              <Textarea
                rows={3}
                value={formData.positioningStatement}
                onChange={(e) => setFormData((p) => ({ ...p, positioningStatement: e.target.value }))}
                placeholder="We help [ICP] achieve [outcome] by [unique mechanism]..."
              />
            </div>
          </CardContent>
          <CardFooter className="bg-muted/30 border-t px-6 py-4">
            <Button onClick={handleSaveBrand} disabled={updateBrand.isPending} className="ml-auto">
              <Save className="h-4 w-4 mr-2" />
              {updateBrand.isPending ? "Saving..." : "Save Profile"}
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Market & Product Context</CardTitle>
            <CardDescription>Geographic focus, product truths, and tone — used to sharpen AI analysis.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <TagInput
              label="Target Geographies"
              description="Countries or regions where the brand operates (e.g. USA, UK, EU)."
              values={formData.targetGeographies}
              onChange={(v) => setFormData((p) => ({ ...p, targetGeographies: v }))}
              placeholder="Add a geography and press Enter"
            />
            <TagInput
              label="Product Truths"
              description="Core verifiable claims about the product (e.g. 'SOC 2 certified', 'Zero-shot setup')."
              values={formData.productTruths}
              onChange={(v) => setFormData((p) => ({ ...p, productTruths: v }))}
              placeholder="Add a product truth and press Enter"
            />
            <TagInput
              label="Tone Descriptors"
              description="Brand voice characteristics (e.g. 'authoritative', 'approachable', 'technical')."
              values={formData.toneDescriptors}
              onChange={(v) => setFormData((p) => ({ ...p, toneDescriptors: v }))}
              placeholder="Add a tone descriptor and press Enter"
            />
          </CardContent>
          <CardFooter className="bg-muted/30 border-t px-6 py-4">
            <Button onClick={handleSaveBrand} disabled={updateBrand.isPending} className="ml-auto">
              <Save className="h-4 w-4 mr-2" />
              {updateBrand.isPending ? "Saving..." : "Save"}
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Competitor Landscape</CardTitle>
            <CardDescription>Track competitors for strategic mapping and gap analysis.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <form onSubmit={handleAddCompetitor} className="flex gap-4 items-end bg-muted/20 p-4 rounded-lg border">
              <div className="flex-1 space-y-2">
                <Label>Competitor Name</Label>
                <Input value={newCompName} onChange={(e) => setNewCompName(e.target.value)} required />
              </div>
              <div className="flex-[2] space-y-2">
                <Label>Notes / Positioning</Label>
                <Input value={newCompNotes} onChange={(e) => setNewCompNotes(e.target.value)} placeholder="e.g. Price leader, legacy enterprise..." />
              </div>
              <Button type="submit" disabled={!newCompName || createCompetitor.isPending}>
                <Plus className="h-4 w-4 mr-2" />Add
              </Button>
            </form>
            <div className="space-y-3">
              {competitorsLoading ? (
                <div className="text-center py-4 text-muted-foreground text-sm">Loading competitors...</div>
              ) : competitors && competitors.length > 0 ? (
                competitors.map((c) => (
                  <div key={c.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/10 transition-colors">
                    <div>
                      <div className="font-semibold text-sm">{c.name}</div>
                      {c.notes && <div className="text-xs text-muted-foreground mt-1">{c.notes}</div>}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground" onClick={() => setEditingCompetitor(c)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => handleDeleteCompetitor(c.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 border border-dashed rounded-lg text-muted-foreground text-sm">
                  No competitors added yet.
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <CreateBrandDialog
          open={showCreate}
          onClose={() => setShowCreate(false)}
          onCreated={(id) => { setActiveBrandId(id); setShowCreate(false); }}
        />

        {editingCompetitor && activeBrandId && (
          <EditCompetitorDialog
            open={!!editingCompetitor}
            onClose={() => setEditingCompetitor(null)}
            competitor={editingCompetitor}
            brandId={activeBrandId}
            onSaved={() => {
              setEditingCompetitor(null);
              queryClient.invalidateQueries({ queryKey: ["brands", activeBrandId, "competitors"] });
            }}
          />
        )}
      </div>
    </Layout>
  );
}
