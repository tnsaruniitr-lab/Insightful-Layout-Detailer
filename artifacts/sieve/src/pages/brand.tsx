import { useState, useEffect } from "react";
import { Layout } from "@/components/layout";
import { useBrandContext } from "@/hooks/use-brand-context";
import { useGetBrand, useUpdateBrand, useGetBrandCompetitors, useCreateCompetitor, useDeleteCompetitor } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Trash2, Plus, Save } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

export default function BrandProfile() {
  const { activeBrandId } = useBrandContext();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const { data: brand, isLoading: brandLoading } = useGetBrand(activeBrandId || 0, { query: { enabled: !!activeBrandId, queryKey: ['brands', activeBrandId] } });
  const { data: competitors, isLoading: competitorsLoading } = useGetBrandCompetitors(activeBrandId || 0, { query: { enabled: !!activeBrandId, queryKey: ['brands', activeBrandId, 'competitors'] } });
  
  const updateBrand = useUpdateBrand();
  const createCompetitor = useCreateCompetitor();
  const deleteCompetitor = useDeleteCompetitor();

  const [formData, setFormData] = useState({
    name: "",
    icpDescription: "",
    positioningStatement: "",
  });

  const [newCompName, setNewCompName] = useState("");
  const [newCompNotes, setNewCompNotes] = useState("");

  useEffect(() => {
    if (brand) {
      setFormData({
        name: brand.name || "",
        icpDescription: brand.icpDescription || "",
        positioningStatement: brand.positioningStatement || "",
      });
    }
  }, [brand]);

  const handleSaveBrand = async () => {
    if (!activeBrandId) return;
    try {
      await updateBrand.mutateAsync({
        id: activeBrandId,
        data: formData
      });
      toast({ title: "Brand profile updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/brands", activeBrandId] });
    } catch (e) {
      toast({ title: "Failed to update brand", variant: "destructive" });
    }
  };

  const handleAddCompetitor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeBrandId || !newCompName) return;
    try {
      await createCompetitor.mutateAsync({
        id: activeBrandId,
        data: { name: newCompName, notes: newCompNotes }
      });
      setNewCompName("");
      setNewCompNotes("");
      toast({ title: "Competitor added" });
      queryClient.invalidateQueries({ queryKey: [`/api/brands/${activeBrandId}/competitors`] });
    } catch (e) {
      toast({ title: "Failed to add competitor", variant: "destructive" });
    }
  };

  const handleDeleteCompetitor = async (competitorId: number) => {
    if (!activeBrandId) return;
    try {
      await deleteCompetitor.mutateAsync({ id: activeBrandId, competitorId });
      toast({ title: "Competitor removed" });
      queryClient.invalidateQueries({ queryKey: [`/api/brands/${activeBrandId}/competitors`] });
    } catch (e) {
      toast({ title: "Failed to remove competitor", variant: "destructive" });
    }
  };

  if (!activeBrandId) return <Layout><div className="p-8 text-center">No active brand selected.</div></Layout>;

  return (
    <Layout>
      <div className="space-y-8 max-w-4xl mx-auto">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Brand Profile</h1>
          <p className="text-muted-foreground">Configure the core identity and positioning for {brand?.name}.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Core Identity</CardTitle>
            <CardDescription>Foundation details used by the intelligence engine for context.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Brand Name</Label>
              <Input 
                value={formData.name} 
                onChange={(e) => setFormData(prev => ({...prev, name: e.target.value}))} 
              />
            </div>
            <div className="space-y-2">
              <Label>Ideal Customer Profile (ICP)</Label>
              <Textarea 
                rows={4}
                value={formData.icpDescription} 
                onChange={(e) => setFormData(prev => ({...prev, icpDescription: e.target.value}))}
                placeholder="Describe your target audience..."
              />
            </div>
            <div className="space-y-2">
              <Label>Positioning Statement</Label>
              <Textarea 
                rows={4}
                value={formData.positioningStatement} 
                onChange={(e) => setFormData(prev => ({...prev, positioningStatement: e.target.value}))}
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
            <CardTitle>Competitor Landscape</CardTitle>
            <CardDescription>Track competitors for strategic mapping and gap analysis.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <form onSubmit={handleAddCompetitor} className="flex gap-4 items-end bg-muted/20 p-4 rounded-lg border">
              <div className="flex-1 space-y-2">
                <Label>Competitor Name</Label>
                <Input value={newCompName} onChange={e => setNewCompName(e.target.value)} required />
              </div>
              <div className="flex-[2] space-y-2">
                <Label>Notes / Positioning</Label>
                <Input value={newCompNotes} onChange={e => setNewCompNotes(e.target.value)} placeholder="e.g. Price leader, legacy enterprise..." />
              </div>
              <Button type="submit" disabled={!newCompName || createCompetitor.isPending}>
                <Plus className="h-4 w-4 mr-2" /> Add
              </Button>
            </form>

            <div className="space-y-3">
              {competitorsLoading ? (
                <div className="text-center py-4 text-muted-foreground text-sm">Loading competitors...</div>
              ) : competitors && competitors.length > 0 ? (
                competitors.map(c => (
                  <div key={c.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/10 transition-colors">
                    <div>
                      <div className="font-semibold text-sm">{c.name}</div>
                      {c.notes && <div className="text-xs text-muted-foreground mt-1">{c.notes}</div>}
                    </div>
                    <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => handleDeleteCompetitor(c.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
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
      </div>
    </Layout>
  );
}
