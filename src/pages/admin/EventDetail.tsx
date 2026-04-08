import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Upload, Users, QrCode, Image as ImageIcon, X, Grid3X3,
  BarChart3, CheckCircle2, XCircle, Loader2, RefreshCw, AlertTriangle, ArrowRight, Copy, Check, Merge, Trash2, Sparkles, Eye, ChevronLeft, ChevronRight,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { uploadBatchToSupabase } from "@/lib/supabase-storage";
import { getSafeErrorMessage, validateImageFile, formatFileSize } from "@/lib/error-handler";
import {
  getEventPendingUploads, updatePendingUpload, removePendingUpload,
  clearFailedUploads as clearStoredFailedUploads, restoreFileFromPending,
  getRetryableUploads, type PendingUpload,
} from "@/lib/upload-persistence";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { preprocessImages, getPreprocessingSummary } from "@/lib/image-preprocessing";
import { Badge } from "@/components/ui/badge";

interface FileUploadState {
  file: File;
  status: 'pending' | 'preprocessing' | 'uploading' | 'success' | 'error';
  progress: number;
  url?: string;
  error?: string;
}

interface EventData {
  id: string;
  name: string;
  status: string;
  admin_id: string;
  created_at: string;
}

interface PersonData {
  id: string;
  event_id: string;
  person_id: number;
  name: string | null;
  qr_code: string | null;
  qr_url: string | null;
  access_token: string | null;
  previewImage?: string | null;
  previewBbox?: { x: number; y: number; w: number; h: number } | null;
  imageCount?: number;
}

const BATCH_SIZE = 5;

export default function EventDetail() {
  const { eventId } = useParams();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [event, setEvent] = useState<EventData | null>(null);
  const [persons, setPersons] = useState<PersonData[]>([]);
  const [uploadedImageUrls, setUploadedImageUrls] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [clustering, setClustering] = useState(false);
  const [fileStates, setFileStates] = useState<FileUploadState[]>([]);
  const { toast } = useToast();
  const [isDragOver, setIsDragOver] = useState(false);
  const [preprocessing, setPreprocessing] = useState(false);
  const [preprocessProgress, setPreprocessProgress] = useState({ done: 0, total: 0 });
  const [storedPendingUploads, setStoredPendingUploads] = useState<PendingUpload[]>([]);
  const [retryingStored, setRetryingStored] = useState(false);
  const [activeTab, setActiveTab] = useState("upload");
  
  // Merge state
  const [mergeMode, setMergeMode] = useState(false);
  const [selectedForMerge, setSelectedForMerge] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState(false);
  
  // Suggest similar state
  const [suggestingSimilar, setSuggestingSimilar] = useState(false);
  const [similarGroups, setSimilarGroups] = useState<{ personIds: string[]; confidence: number; reason: string }[]>([]);
  const [highlightedGroup, setHighlightedGroup] = useState<number | null>(null);

  useEffect(() => {
    if (eventId) {
      const stored = getEventPendingUploads(eventId).filter(u => u.status === "failed");
      setStoredPendingUploads(stored);
    }
  }, [eventId]);

  useEffect(() => {
    if (eventId && user) { fetchEvent(); fetchPersons(); }
  }, [eventId, user]);

  const fetchEvent = async () => {
    if (!eventId) return;
    try {
      const { data, error } = await supabase.from("events").select("*").eq("id", eventId).single();
      if (error) throw error;
      setEvent(data);
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error loading event", description: getSafeErrorMessage(error) });
    } finally {
      setLoading(false);
    }
  };

  const fetchPersons = async () => {
    if (!eventId) return;
    try {
      const { data, error } = await supabase.from("persons").select("*").eq("event_id", eventId).order("person_id");
      if (error) throw error;

      const personsWithImages: PersonData[] = await Promise.all(
        (data || []).map(async (person) => {
          const { data: images, count } = await supabase
            .from("person_images")
            .select("image_url, bbox", { count: "exact" })
            .eq("person_id", person.id)
            .limit(1);
          const firstImage = images?.[0];
          return {
            ...person,
            previewImage: firstImage?.image_url || null,
            previewBbox: (firstImage?.bbox as { x: number; y: number; w: number; h: number } | null) || null,
            imageCount: count || 0,
          } as PersonData;
        })
      );

      setPersons(personsWithImages);
    } catch (error: any) {
      console.error("Error fetching persons:", error);
    }
  };

  // ── Merge logic ──
  const toggleMergeSelection = (personId: string) => {
    setSelectedForMerge(prev => {
      const next = new Set(prev);
      if (next.has(personId)) next.delete(personId);
      else next.add(personId);
      return next;
    });
  };

  const handleMergePersons = async () => {
    if (selectedForMerge.size < 2) {
      toast({ variant: "destructive", title: "Select at least 2 persons to merge" });
      return;
    }
    setMerging(true);
    try {
      const selected = persons.filter(p => selectedForMerge.has(p.id));
      // Keep the one with a name, or the one with most images, or the first
      const canonical = selected.reduce((best, p) => {
        if (p.name && !best.name) return p;
        if ((p.imageCount ?? 0) > (best.imageCount ?? 0)) return p;
        return best;
      }, selected[0]);

      const toMerge = selected.filter(p => p.id !== canonical.id);

      for (const person of toMerge) {
        // Move all images to canonical person
        const { error: moveError } = await supabase
          .from("person_images")
          .update({ person_id: canonical.id })
          .eq("person_id", person.id);
        if (moveError) throw moveError;

        // Move favorites
        await supabase
          .from("favorites")
          .update({ person_id: canonical.id })
          .eq("person_id", person.id);

        // Delete the duplicate person
        const { error: deleteError } = await supabase
          .from("persons")
          .delete()
          .eq("id", person.id);
        if (deleteError) throw deleteError;
      }

      toast({ title: "Persons merged!", description: `${toMerge.length} person(s) merged into "${canonical.name || `Person ${canonical.person_id}`}"` });
      setSelectedForMerge(new Set());
      setMergeMode(false);
      await fetchPersons();
    } catch (error: any) {
      toast({ variant: "destructive", title: "Merge failed", description: getSafeErrorMessage(error) });
    } finally {
      setMerging(false);
    }
  };

  // ── Suggest Similar ──
  const handleSuggestSimilar = async () => {
    if (!eventId) return;
    setSuggestingSimilar(true);
    setSimilarGroups([]);
    setHighlightedGroup(null);
    try {
      const { data, error } = await supabase.functions.invoke("suggest-similar", { body: { eventId } });
      if (error) throw error;
      const groups = data?.similarGroups || [];
      setSimilarGroups(groups);
      if (groups.length === 0) {
        toast({ title: "No duplicates found", description: "AI didn't find any similar persons to merge." });
      } else {
        toast({ title: `Found ${groups.length} potential duplicate${groups.length !== 1 ? 's' : ''}`, description: "Click a suggestion to highlight and merge." });
      }
    } catch (error: any) {
      toast({ variant: "destructive", title: "Suggest similar failed", description: getSafeErrorMessage(error) });
    } finally {
      setSuggestingSimilar(false);
    }
  };

  const handleAcceptSuggestion = (groupIndex: number) => {
    const group = similarGroups[groupIndex];
    if (!group) return;
    setMergeMode(true);
    setSelectedForMerge(new Set(group.personIds));
    setHighlightedGroup(groupIndex);
  };

  const handleDismissSuggestion = (groupIndex: number) => {
    setSimilarGroups(prev => prev.filter((_, i) => i !== groupIndex));
    if (highlightedGroup === groupIndex) {
      setHighlightedGroup(null);
      setSelectedForMerge(new Set());
      setMergeMode(false);
    }
  };

  const uploadValidFiles = useCallback(async (validFiles: File[]) => {
    if (!eventId || validFiles.length === 0) return;
    const initialStates: FileUploadState[] = validFiles.map((file) => ({ file, status: "pending", progress: 0 }));
    setFileStates(initialStates);
    setUploading(true);

    try {
      const result = await uploadBatchToSupabase(
        validFiles, eventId,
        (fileIndex, progress) => {
          setFileStates((prev) => prev.map((state, idx) => idx === fileIndex ? { ...state, status: "uploading", progress } : state));
        },
        (fileIndex, url, error) => {
          setFileStates((prev) => prev.map((state, idx) => idx === fileIndex ? { ...state, status: error ? "error" : "success", progress: error ? state.progress : 100, url: url || undefined, error: error?.message } : state));
        },
        BATCH_SIZE
      );

      const newUrls = result.successful.map((s) => s.url);
      if (newUrls.length > 0) {
        setUploadedImageUrls((prev) => [...prev, ...newUrls]);
        await supabase.from("events").update({ status: "uploading" }).eq("id", eventId);
        fetchEvent();
      }

      if (result.failed.length === 0) {
        toast({ title: "Upload complete!", description: `${result.successful.length} photos uploaded successfully.` });
      } else if (result.successful.length === 0) {
        toast({ variant: "destructive", title: "Upload failed", description: `All ${result.failed.length} uploads failed.` });
      } else {
        toast({ title: "Upload partially complete", description: `${result.successful.length} uploaded, ${result.failed.length} failed.` });
      }
    } catch (error: any) {
      toast({ variant: "destructive", title: "Upload failed", description: getSafeErrorMessage(error) });
    } finally {
      setUploading(false);
      setTimeout(() => { setFileStates((prev) => prev.filter((s) => s.status !== "success")); }, 3000);
    }
  }, [eventId, toast]);

  const processFiles = async (files: FileList | File[]) => {
    if (!files || files.length === 0 || !eventId) return;
    const validFiles: File[] = [];
    for (const file of Array.from(files)) {
      const isHeic = file.type === "image/heic" || file.type === "image/heif" || file.name.toLowerCase().endsWith(".heic") || file.name.toLowerCase().endsWith(".heif");
      if (isHeic) { validFiles.push(file); } else {
        const validation = validateImageFile(file);
        if (!validation.valid) { toast({ variant: "destructive", title: "Invalid file", description: validation.error }); } else { validFiles.push(file); }
      }
    }
    if (validFiles.length === 0) return;
    if (!user?.id) { toast({ variant: "destructive", title: "Not authenticated", description: "Please sign in to upload files." }); return; }

    setPreprocessing(true);
    setPreprocessProgress({ done: 0, total: validFiles.length });
    try {
      const preprocessed = await preprocessImages(validFiles, (done, total) => { setPreprocessProgress({ done, total }); });
      const summary = getPreprocessingSummary(preprocessed);
      if (summary.savedPercent > 0) {
        toast({ title: "Images optimized", description: `Reduced size by ${summary.savedPercent}% (${formatFileSize(summary.savedBytes)} saved)` });
      }
      await uploadValidFiles(preprocessed.map((r) => r.file));
    } catch (err: any) {
      toast({ variant: "destructive", title: "Preprocessing failed", description: getSafeErrorMessage(err) });
    } finally {
      setPreprocessing(false);
      setPreprocessProgress({ done: 0, total: 0 });
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) processFiles(files);
    e.target.value = "";
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); e.stopPropagation(); if (!uploading) setIsDragOver(true); };
  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(false); };
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(false); if (uploading) return; const files = e.dataTransfer.files; if (files.length > 0) processFiles(files); };

  const handleCluster = async () => {
    if (!eventId) return;
    setClustering(true);
    try {
      const body: any = { eventId };
      if (uploadedImageUrls.length > 0) body.imageUrls = uploadedImageUrls;

      // Use direct fetch instead of supabase.functions.invoke to avoid timeout
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      const response = await fetch(`${supabaseUrl}/functions/v1/cluster-faces`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify(body),
        // No timeout — clustering can take a while with many photos
      });

      let data: any = {};
      try { data = await response.json(); } catch {}

      if (!response.ok) {
        throw new Error(data?.error || `Server error ${response.status}`);
      }
      if (data?.error) throw new Error(data.error);

      toast({
        title: "Clustering complete! 🎉",
        description: data?.message || `Grouped photos into ${data?.persons || "several"} persons.`,
      });
      await supabase.from("events").update({ status: "ready" }).eq("id", eventId);
      fetchEvent();
      await fetchPersons();
      setSimilarGroups([]);
      setActiveTab("persons");
    } catch (error: any) {
      console.error("Clustering error:", error);
      toast({
        variant: "destructive",
        title: "Clustering failed",
        description: error.message || "An error occurred. Please try again.",
      });
    } finally {
      setClustering(false);
    }
  };

  const handleSaveName = async (personId: string, name: string) => {
    try {
      const { error } = await supabase.from("persons").update({ name }).eq("id", personId);
      if (error) throw error;
      toast({ title: "Name saved!" });
      fetchPersons();
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error saving name", description: getSafeErrorMessage(error) });
    }
  };

  const handleDeletePerson = async (personId: string, personName: string) => {
    try {
      await supabase.from("person_images").delete().eq("person_id", personId);
      await supabase.from("favorites").delete().eq("person_id", personId);
      const { error } = await supabase.from("persons").delete().eq("id", personId);
      if (error) throw error;
      toast({ title: "Person removed", description: `"${personName}" has been removed from this event.` });
      fetchPersons();
    } catch (error: any) {
      toast({ variant: "destructive", title: "Delete failed", description: getSafeErrorMessage(error) });
    }
  };

  const handleGenerateQR = async (personId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke("generate-qr", { body: { eventId, personId } });
      if (error) throw error;
      toast({ title: "QR code generated!" });
      fetchPersons();
    } catch (error: any) {
      toast({ variant: "destructive", title: "QR generation failed", description: getSafeErrorMessage(error) });
    }
  };

  const clearFailedUploads = () => { setFileStates(prev => prev.filter(s => s.status !== 'error')); };

  const retryFailedUpload = async (index: number) => {
    const fileState = fileStates[index];
    if (!fileState || !eventId) return;
    setFileStates(prev => prev.map((s, idx) => idx === index ? { ...s, status: 'uploading', progress: 0, error: undefined } : s));
    try {
      await uploadBatchToSupabase(
        [fileState.file], eventId,
        (_, progress) => { setFileStates(prev => prev.map((s, idx) => idx === index ? { ...s, progress } : s)); },
        (_, url, error) => {
          setFileStates(prev => prev.map((s, idx) => idx === index ? { ...s, status: error ? 'error' : 'success', url: url || undefined, error: error?.message } : s));
          if (url) setUploadedImageUrls(prev => [...prev, url]);
        }
      );
    } catch (error: any) {
      setFileStates(prev => prev.map((s, idx) => idx === index ? { ...s, status: 'error', error: getSafeErrorMessage(error) } : s));
    }
  };

  const overallProgress = fileStates.length > 0 ? fileStates.reduce((sum, s) => sum + s.progress, 0) / fileStates.length : 0;
  const successCount = fileStates.filter(s => s.status === 'success').length;
  const errorCount = fileStates.filter(s => s.status === 'error').length;
  const pendingCount = fileStates.filter(s => s.status === 'pending' || s.status === 'uploading').length;

  const handleRetryStoredUploads = useCallback(async () => {
    if (!eventId || !user?.id) { toast({ variant: "destructive", title: "Cannot retry", description: "Please sign in first." }); return; }
    const retryable = getRetryableUploads(eventId);
    if (retryable.length === 0) return;
    setRetryingStored(true);
    for (const pending of retryable) {
      const file = restoreFileFromPending(pending);
      if (!file) { updatePendingUpload(pending.id, { status: "failed", error: "File data not available" }); continue; }
      updatePendingUpload(pending.id, { status: "uploading", progress: 0 });
      setStoredPendingUploads(prev => prev.map(p => p.id === pending.id ? { ...p, status: "uploading" as const } : p));
      try {
        await uploadBatchToSupabase(
          [file], eventId,
          (_, progress) => { updatePendingUpload(pending.id, { progress }); },
          (_, url, error) => {
            if (url) {
              removePendingUpload(pending.id);
              setUploadedImageUrls(prev => [...prev, url]);
              setStoredPendingUploads(prev => prev.filter(p => p.id !== pending.id));
            } else {
              updatePendingUpload(pending.id, { status: "failed", error: error?.message });
              setStoredPendingUploads(prev => prev.map(p => p.id === pending.id ? { ...p, status: "failed" as const, error: error?.message } : p));
            }
          }
        );
      } catch (error: any) {
        updatePendingUpload(pending.id, { status: "failed", error: getSafeErrorMessage(error) });
      }
    }
    setRetryingStored(false);
    toast({ title: "Retry complete", description: "Check results above." });
  }, [eventId, user?.id, toast]);

  const handleClearStoredFailed = useCallback(() => {
    if (eventId) { clearStoredFailedUploads(eventId); setStoredPendingUploads([]); }
  }, [eventId]);

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-background"><Navbar />
        <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
            <p className="mt-4 text-muted-foreground">Loading event...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="min-h-screen bg-background"><Navbar />
        <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
          <div className="text-center">
            <p className="text-muted-foreground">Event not found</p>
            <Button onClick={() => navigate("/admin/events")} className="mt-4">Back to Events</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold text-primary mb-2">{event.name}</h1>
            <p className="text-muted-foreground">Status: <span className="font-medium capitalize">{event.status}</span></p>
          </div>
          <Button variant="outline" onClick={() => navigate(`/admin/event/${eventId}/analytics`)}>
            <BarChart3 className="mr-2 h-4 w-4" />Analytics
          </Button>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="upload">Upload</TabsTrigger>
            <TabsTrigger value="cluster">Cluster</TabsTrigger>
            <TabsTrigger value="persons">Persons {persons.length > 0 && `(${persons.length})`}</TabsTrigger>
          </TabsList>

          <TabsContent value="upload">
            <Card className="card-shadow-lg">
              <CardHeader>
                <CardTitle>Upload Photos</CardTitle>
                <CardDescription>Upload event photos to start face clustering</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {storedPendingUploads.length > 0 && (
                    <Alert variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertTitle>Failed uploads from previous session</AlertTitle>
                      <AlertDescription className="flex items-center justify-between">
                        <span>{storedPendingUploads.length} upload(s) failed previously and can be retried.</span>
                        <div className="flex gap-2 ml-4">
                          <Button variant="outline" size="sm" onClick={handleRetryStoredUploads} disabled={retryingStored || !user}>
                            {retryingStored ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}Retry All
                          </Button>
                          <Button variant="ghost" size="sm" onClick={handleClearStoredFailed}>Clear</Button>
                        </div>
                      </AlertDescription>
                    </Alert>
                  )}

                  {preprocessing && (
                    <Alert>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <AlertTitle>Optimizing images…</AlertTitle>
                      <AlertDescription>Processing {preprocessProgress.done} of {preprocessProgress.total} images</AlertDescription>
                    </Alert>
                  )}

                  <div
                    className={`border-2 border-dashed rounded-lg p-12 text-center transition-all duration-200 ${isDragOver ? 'border-primary bg-primary/5 scale-[1.02]' : 'border-border hover:border-primary'} ${uploading || preprocessing ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                    onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
                    onClick={() => !uploading && !preprocessing && document.getElementById('file-upload')?.click()}
                  >
                    <Upload className={`h-12 w-12 mx-auto mb-4 transition-colors ${isDragOver ? 'text-primary' : 'text-muted-foreground'}`} />
                    <Label htmlFor="file-upload" className="cursor-pointer">
                      <span className="text-primary font-medium">Click to upload</span>
                      <span className="text-muted-foreground"> or drag and drop</span>
                    </Label>
                    <Input id="file-upload" type="file" multiple accept="image/*,.heic,.heif" className="sr-only" onChange={handleUpload} disabled={uploading || preprocessing} />
                    <p className="text-sm text-muted-foreground mt-2">PNG, JPG, WEBP, HEIC up to 50MB each (auto-optimized)</p>
                  </div>

                  {fileStates.length > 0 && (
                    <div className="space-y-3 border border-border rounded-lg p-4">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium">{uploading ? 'Uploading...' : 'Upload Progress'}</span>
                          <span className="text-muted-foreground">{successCount}/{fileStates.length} complete</span>
                        </div>
                        <Progress value={overallProgress} className="h-2" />
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          {successCount > 0 && <span className="flex items-center gap-1 text-green-600"><CheckCircle2 className="h-3 w-3" /> {successCount} successful</span>}
                          {errorCount > 0 && <span className="flex items-center gap-1 text-destructive"><XCircle className="h-3 w-3" /> {errorCount} failed</span>}
                          {pendingCount > 0 && <span className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> {pendingCount} in progress</span>}
                        </div>
                      </div>
                      <div className="max-h-60 overflow-y-auto space-y-2">
                        {fileStates.map((fileState, index) => (
                          <div key={index} className={`flex items-center gap-3 p-2 rounded-md text-sm ${fileState.status === 'error' ? 'bg-destructive/10' : 'bg-muted/50'}`}>
                            <div className="flex-shrink-0">
                              {fileState.status === 'pending' && <div className="h-4 w-4 rounded-full border-2 border-muted-foreground" />}
                              {fileState.status === 'uploading' && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                              {fileState.status === 'success' && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                              {fileState.status === 'error' && <XCircle className="h-4 w-4 text-destructive" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="truncate font-medium">{fileState.file.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {formatFileSize(fileState.file.size)}
                                {fileState.status === 'uploading' && ` • ${Math.round(fileState.progress)}%`}
                                {fileState.error && <span className="text-destructive"> • {fileState.error}</span>}
                              </p>
                            </div>
                            {fileState.status === 'uploading' && <div className="w-20 flex-shrink-0"><Progress value={fileState.progress} className="h-1" /></div>}
                            {fileState.status === 'error' && <Button variant="ghost" size="sm" onClick={() => retryFailedUpload(index)} className="flex-shrink-0">Retry</Button>}
                          </div>
                        ))}
                      </div>
                      {errorCount > 0 && !uploading && <Button variant="outline" size="sm" onClick={clearFailedUploads} className="w-full">Clear failed uploads</Button>}
                    </div>
                  )}

                  {uploadedImageUrls.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Grid3X3 className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm font-medium">{uploadedImageUrls.length} photo{uploadedImageUrls.length !== 1 ? 's' : ''} ready</span>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => setUploadedImageUrls([])} className="text-destructive hover:text-destructive">Clear all</Button>
                      </div>
                      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                        {uploadedImageUrls.map((url, index) => (
                          <div key={index} className="relative group aspect-square rounded-lg overflow-hidden border border-border">
                            <img src={url} alt={`Uploaded ${index + 1}`} className="w-full h-full object-cover" />
                            <button onClick={() => setUploadedImageUrls(prev => prev.filter((_, i) => i !== index))} className="absolute top-1 right-1 p-1 bg-background/80 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>

                      {!uploading && uploadedImageUrls.length > 0 && (
                        <Button
                          onClick={async () => {
                            setActiveTab("cluster");
                            // Small delay to let tab switch animate, then auto-start clustering
                            setTimeout(() => handleCluster(), 300);
                          }}
                          className="w-full bg-gradient-to-r from-primary to-blue-600 hover:from-primary/90 hover:to-blue-600/90 text-white font-semibold"
                          size="lg"
                        >
                          <Sparkles className="mr-2 h-5 w-5" />
                          Start Clustering
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="cluster">
            <Card className="card-shadow-lg">
              <CardHeader><CardTitle>Cluster Faces</CardTitle><CardDescription>AI will automatically group faces into individuals</CardDescription></CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="text-center py-8">
                    {clustering ? (
                      <div className="flex flex-col items-center gap-8 py-4">
                        <style>{`
                          @keyframes orbitA { 0%{transform:rotate(0deg) translateX(52px) rotate(0deg)} 100%{transform:rotate(360deg) translateX(52px) rotate(-360deg)} }
                          @keyframes orbitB { 0%{transform:rotate(120deg) translateX(36px) rotate(-120deg)} 100%{transform:rotate(480deg) translateX(36px) rotate(-480deg)} }
                          @keyframes orbitC { 0%{transform:rotate(240deg) translateX(20px) rotate(-240deg)} 100%{transform:rotate(600deg) translateX(20px) rotate(-600deg)} }
                          @keyframes pulseRing { 0%,100%{transform:scale(1);opacity:0.3} 50%{transform:scale(1.15);opacity:0.6} }
                          @keyframes scanLine { 0%{top:0%;opacity:0} 10%{opacity:1} 90%{opacity:1} 100%{top:100%;opacity:0} }
                          @keyframes faceAppear { 0%{opacity:0;transform:scale(0.5)} 100%{opacity:1;transform:scale(1)} }
                          @keyframes dotFloat { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }
                        `}</style>

                        {/* Lottie-style face clustering animation */}
                        <div className="relative w-48 h-48">
                          {/* Outer ring */}
                          <div className="absolute inset-0 rounded-full border border-primary/10" style={{animation:"pulseRing 2s ease-in-out infinite"}} />
                          <div className="absolute inset-2 rounded-full border border-primary/15" style={{animation:"pulseRing 2s ease-in-out infinite",animationDelay:"0.3s"}} />
                          <div className="absolute inset-5 rounded-full border border-primary/20" style={{animation:"pulseRing 2s ease-in-out infinite",animationDelay:"0.6s"}} />

                          {/* Orbiting face avatars — outer */}
                          {["👤","👥","🙂","😊","👤","😄"].map((emoji, i) => (
                            <div key={i} className="absolute w-8 h-8 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center text-sm"
                              style={{
                                top:"50%", left:"50%", marginTop:"-16px", marginLeft:"-16px",
                                animation:`orbitA ${3+i*0.3}s linear infinite`,
                                animationDelay:`${i * (3/6)}s`,
                              }}>
                              <span style={{fontSize:"12px"}}>{emoji}</span>
                            </div>
                          ))}

                          {/* Middle orbit dots */}
                          {[0,1,2].map(i => (
                            <div key={i} className="absolute w-3 h-3 rounded-full bg-blue-400/60"
                              style={{
                                top:"50%", left:"50%", marginTop:"-6px", marginLeft:"-6px",
                                animation:`orbitB 2s linear infinite`,
                                animationDelay:`${i * (2/3)}s`,
                              }} />
                          ))}

                          {/* Center */}
                          <div className="absolute inset-0 flex items-center justify-center">
                            <div className="relative w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/10 border border-primary/30 flex items-center justify-center overflow-hidden shadow-lg shadow-primary/20">
                              {/* Scan line */}
                              <div className="absolute left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent"
                                style={{animation:"scanLine 2s linear infinite"}} />
                              <Users className="h-8 w-8 text-primary" />
                            </div>
                          </div>

                          {/* Floating mini dots */}
                          {[...Array(4)].map((_,i) => (
                            <div key={i} className="absolute w-1.5 h-1.5 rounded-full bg-primary/40"
                              style={{
                                top:`${20+i*20}%`, left:`${10+i*25}%`,
                                animation:`dotFloat ${1.5+i*0.3}s ease-in-out infinite`,
                                animationDelay:`${i*0.4}s`
                              }} />
                          ))}
                        </div>

                        {/* Status text */}
                        <div className="text-center space-y-2">
                          <p className="text-base font-bold text-foreground">AI Clustering in Progress</p>
                          <p className="text-sm text-muted-foreground">Face++ is analyzing and grouping faces</p>
                        </div>

                        {/* Progress steps */}
                        <div className="w-full max-w-xs space-y-2">
                          {[
                            { label: "Detecting faces", icon: "🔍" },
                            { label: "Matching identities", icon: "🔗" },
                            { label: "Building person groups", icon: "👥" },
                          ].map((step, i) => (
                            <div key={i} className="flex items-center gap-3 p-2.5 rounded-xl bg-muted/40 border border-border/50">
                              <span className="text-base" style={{animation:`dotFloat 1.5s ease-in-out infinite`,animationDelay:`${i*0.5}s`}}>{step.icon}</span>
                              <span className="text-xs text-muted-foreground">{step.label}</span>
                              <div className="ml-auto flex gap-0.5">
                                {[0,1,2].map(j => (
                                  <div key={j} className="w-1 h-1 rounded-full bg-primary/60"
                                    style={{animation:`dotFloat 0.8s ease-in-out infinite`,animationDelay:`${i*0.3+j*0.15}s`}} />
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <>
                        <ImageIcon className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
                        <p className="text-muted-foreground mb-6">
                          {uploadedImageUrls.length > 0
                            ? `${uploadedImageUrls.length} new photos ready to cluster`
                            : event.status === 'created'
                              ? 'Upload photos first, then come back here to cluster'
                              : 'Click below to run (or re-run) face clustering on all uploaded photos'}
                        </p>
                        <Button onClick={handleCluster} disabled={clustering} size="lg">
                          <Sparkles className="mr-2 h-5 w-5" />Start Clustering
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="persons">
            {persons.length === 0 ? (
              <Card className="col-span-full">
                <CardContent className="text-center py-12">
                  <Users className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground mb-4">No persons identified yet. Cluster faces first.</p>
                  <Button variant="outline" onClick={() => setActiveTab("cluster")}>
                    Go to Clustering <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="flex items-center justify-between mb-4">
                  <p className="text-sm text-muted-foreground">{persons.length} person{persons.length !== 1 ? 's' : ''} identified</p>
                  <div className="flex items-center gap-2">
                    {mergeMode ? (
                      <>
                        <span className="text-sm text-muted-foreground">
                          {selectedForMerge.size} selected
                        </span>
                        <Button
                          size="sm"
                          onClick={handleMergePersons}
                          disabled={selectedForMerge.size < 2 || merging}
                        >
                          {merging ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Merge className="mr-2 h-4 w-4" />}
                          Merge ({selectedForMerge.size})
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => { setMergeMode(false); setSelectedForMerge(new Set()); }}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button variant="outline" size="sm" onClick={handleSuggestSimilar} disabled={suggestingSimilar || persons.length < 2}>
                          {suggestingSimilar ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                          {suggestingSimilar ? 'Analyzing...' : 'Suggest Similar'}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setMergeMode(true)}>
                          <Merge className="mr-2 h-4 w-4" />Manual Merge
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setActiveTab("cluster")}>
                          <RefreshCw className="mr-2 h-4 w-4" />Re-cluster
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {/* AI Similarity Suggestions */}
                {similarGroups.length > 0 && (
                  <div className="mb-4 space-y-2">
                    <p className="text-sm font-medium text-foreground flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-primary" />
                      AI found {similarGroups.length} potential duplicate{similarGroups.length !== 1 ? 's' : ''}
                    </p>
                    {similarGroups.map((group, idx) => {
                      const groupPersons = persons.filter(p => group.personIds.includes(p.id));
                      return (
                        <div key={idx} className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${highlightedGroup === idx ? 'border-primary bg-primary/5' : 'border-border bg-card'}`}>
                          <div className="flex -space-x-3 flex-shrink-0">
                            {groupPersons.map(p => (
                              <div key={p.id} className="w-10 h-10 rounded-full border-2 border-background overflow-hidden bg-muted">
                                {p.previewImage ? (
                                  <FaceCropImage src={p.previewImage} bbox={p.previewBbox} alt={p.name || ''} />
                                ) : (
                                  <div className="flex items-center justify-center h-full"><Users className="h-4 w-4 text-muted-foreground" /></div>
                                )}
                              </div>
                            ))}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {groupPersons.map(p => p.name || `Person ${p.person_id}`).join(' & ')}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">{group.reason} • {Math.round(group.confidence * 100)}% confident</p>
                          </div>
                          <div className="flex gap-1 flex-shrink-0">
                            <Button size="sm" variant="default" className="h-7 text-xs" onClick={() => handleAcceptSuggestion(idx)}>
                              <Merge className="mr-1 h-3 w-3" />Merge
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => handleDismissSuggestion(idx)}>
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {mergeMode && !similarGroups.length && (
                  <Alert className="mb-4">
                    <Merge className="h-4 w-4" />
                    <AlertTitle>Merge Mode</AlertTitle>
                    <AlertDescription>
                      Tap on persons who are the same individual, then click "Merge". Their photos will be combined into one person.
                    </AlertDescription>
                  </Alert>
                )}

                <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                  {persons.map((person) => {
                    const isSuggested = similarGroups.some(g => g.personIds.includes(person.id));
                    return (
                      <PersonCard
                        key={person.id}
                        person={person}
                        onSaveName={handleSaveName}
                        onGenerateQR={handleGenerateQR}
                        onDeletePerson={handleDeletePerson}
                        mergeMode={mergeMode}
                        isSelectedForMerge={selectedForMerge.has(person.id)}
                        onToggleMerge={() => toggleMergeSelection(person.id)}
                        isSuggested={isSuggested}
                      />
                    );
                  })}
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// ── PersonPhotosModal ──
// Helper: compute CSS object-position from bbox to zoom into face
// Google Photos-style face crop — correct CSS background-position math
function FaceCropImage({
  src, bbox, alt, className = ""
}: {
  src: string;
  bbox?: { x: number; y: number; w: number; h: number } | null;
  alt: string;
  className?: string;
}) {
  const hasBbox = bbox && bbox.w >= 3 && bbox.h >= 3 && bbox.w <= 80 && bbox.h <= 80;

  if (!hasBbox) {
    return (
      <div className={`w-full h-full ${className}`} style={{
        backgroundImage: `url(${src})`,
        backgroundSize: "150%",
        backgroundPosition: "center 10%",
        backgroundRepeat: "no-repeat",
      }} />
    );
  }

  // Face center as fraction (0-1)
  const fcx = (bbox.x + bbox.w / 2) / 100;
  const fcy = (bbox.y + bbox.h / 2) / 100;

  // Zoom so face fills ~65% of circle width. Clamp 2x–6x.
  const zoom = Math.min(Math.max(65 / bbox.w, 2), 6);

  // CSS background-position % correct formula:
  // bgPos = (faceCenter - 0.5/zoom) / (1 - 1/zoom)
  const bpx = zoom === 1 ? 0.5 : Math.min(Math.max((fcx - 0.5 / zoom) / (1 - 1 / zoom), 0), 1);
  const fcyAdj = Math.max(fcy - 0.05, 0.02); // slight headroom
  const bpy = zoom === 1 ? 0.5 : Math.min(Math.max((fcyAdj - 0.5 / zoom) / (1 - 1 / zoom), 0), 1);

  return (
    <div className={`w-full h-full ${className}`} style={{
      backgroundImage: `url(${src})`,
      backgroundSize: `${zoom * 100}%`,
      backgroundPosition: `${(bpx * 100).toFixed(1)}% ${(bpy * 100).toFixed(1)}%`,
      backgroundRepeat: "no-repeat",
    }} />
  );
}

function getFaceCropStyle(bbox: { x: number; y: number; w: number; h: number } | null | undefined): React.CSSProperties {
  if (!bbox || bbox.w <= 0 || bbox.h <= 0 || bbox.w > 100 || bbox.h > 100 || bbox.w < 3) {
    return { objectFit: "cover" as const, objectPosition: "center 15%" };
  }
  const cx = Math.min(Math.max(bbox.x + bbox.w / 2, 5), 95);
  const cy = Math.min(Math.max(bbox.y + bbox.h / 2 - 8, 3), 88);
  const scale = Math.min(Math.max(55 / bbox.w, 1.5), 5);
  return {
    objectFit: "cover" as const,
    objectPosition: `${cx}% ${cy}%`,
    transform: `scale(${scale.toFixed(2)})`,
    transformOrigin: `${cx}% ${cy}%`,
  };
}

function PersonPhotosModal({ person, open, onClose }: { person: PersonData; open: boolean; onClose: () => void }) {
  const [photos, setPhotos] = useState<{ id: string; image_url: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    supabase.from("person_images").select("id, image_url").eq("person_id", person.id)
      .order("created_at", { ascending: true })
      .then(({ data }) => { setPhotos(data || []); setLoading(false); });
  }, [open, person.id]);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {person.previewImage && (
              <img src={person.previewImage} className="w-8 h-8 rounded-full object-cover" />
            )}
            {person.name || `Person ${person.person_id}`}
            <span className="text-sm font-normal text-muted-foreground ml-1">
              — {person.imageCount ?? 0} photos
            </span>
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : photos.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">No photos found</div>
        ) : (
          <div className="overflow-y-auto flex-1">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 p-1">
              {photos.map((photo, idx) => (
                <div
                  key={photo.id}
                  className="aspect-square rounded-lg overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary transition-all relative group"
                  onClick={() => setLightbox(idx)}
                >
                  <img src={photo.image_url} alt={`Photo ${idx + 1}`}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                    <Eye className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Lightbox inside modal */}
        {lightbox !== null && (
          <div className="fixed inset-0 bg-black/90 z-[100] flex items-center justify-center" onClick={() => setLightbox(null)}>
            <button className="absolute top-4 right-4 p-2 text-white/70 hover:text-white" onClick={() => setLightbox(null)}>
              <X className="h-6 w-6" />
            </button>
            <button className="absolute left-4 top-1/2 -translate-y-1/2 p-2 text-white/70 hover:text-white"
              onClick={e => { e.stopPropagation(); setLightbox(i => i !== null ? Math.max(0, i - 1) : null); }}>
              <ChevronLeft className="h-8 w-8" />
            </button>
            <img src={photos[lightbox].image_url} className="max-h-[85vh] max-w-[85vw] object-contain rounded-lg"
              onClick={e => e.stopPropagation()} />
            <button className="absolute right-4 top-1/2 -translate-y-1/2 p-2 text-white/70 hover:text-white"
              onClick={e => { e.stopPropagation(); setLightbox(i => i !== null ? Math.min(photos.length - 1, i + 1) : null); }}>
              <ChevronRight className="h-8 w-8" />
            </button>
            <p className="absolute bottom-4 text-white/50 text-sm">{lightbox + 1} / {photos.length}</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── PersonCard ──

interface PersonCardProps {
  person: PersonData;
  onSaveName: (id: string, name: string) => void;
  onGenerateQR: (personId: string) => void;
  onDeletePerson: (personId: string, name: string) => void;
  mergeMode: boolean;
  isSelectedForMerge: boolean;
  onToggleMerge: () => void;
  isSuggested?: boolean;
}

function PersonCard({ person, onSaveName, onGenerateQR, onDeletePerson, mergeMode, isSelectedForMerge, onToggleMerge, isSuggested }: PersonCardProps) {
  const [name, setName] = useState(person.name || "");
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showPhotos, setShowPhotos] = useState(false);
  const { toast } = useToast();

  const handleSave = () => { if (name.trim()) { onSaveName(person.id, name); setEditing(false); } };

  const handleCopyCode = () => {
    if (person.qr_code) {
      navigator.clipboard.writeText(person.qr_code);
      setCopied(true);
      toast({ title: "Code copied!", description: "Share this code with the person to access their photos." });
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleCopyLink = () => {
    if (person.qr_code) {
      const parts = person.qr_code.split('_');
      if (parts.length >= 3) {
        const link = `${window.location.origin}/event/${parts[0]}/${parts[1]}/${parts.slice(2).join('_')}`;
        navigator.clipboard.writeText(link);
        toast({ title: "Link copied!", description: "Share this link directly to access photos." });
      }
    }
  };

  const handleClick = () => {
    if (mergeMode) {
      onToggleMerge();
    } else {
      setExpanded(!expanded);
    }
  };

  return (
    <div className="group flex flex-col items-center">
      <button
        onClick={handleClick}
        className={`relative w-full aspect-square rounded-full overflow-hidden bg-muted border-3 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2
          ${mergeMode
            ? isSelectedForMerge
              ? 'border-primary ring-2 ring-primary ring-offset-2 shadow-lg scale-95'
              : 'border-border hover:border-primary/50 opacity-80 hover:opacity-100'
            : isSuggested
              ? 'border-accent ring-2 ring-accent/50 ring-offset-1 shadow-md animate-pulse'
              : 'border-transparent group-hover:border-primary group-hover:shadow-lg'
          }`}
      >
        {person.previewImage ? (
          <FaceCropImage
            src={person.previewImage}
            bbox={person.previewBbox}
            alt={person.name || `Person ${person.person_id}`}
          />
        ) : (
          <div className="flex items-center justify-center h-full bg-muted"><Users className="h-10 w-10 text-muted-foreground" /></div>
        )}
        {!mergeMode && (
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 rounded-full" />
        )}
        {/* View Photos button on hover */}
        {!mergeMode && (person.imageCount ?? 0) > 0 && (
          <button
            className="absolute bottom-2 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-all duration-200 bg-white/90 text-gray-800 text-xs font-medium px-2.5 py-1 rounded-full flex items-center gap-1 hover:bg-white shadow-md whitespace-nowrap z-10"
            onClick={e => { e.stopPropagation(); setShowPhotos(true); }}
          >
            <Eye className="h-3 w-3" />View Photos
          </button>
        )}
        {mergeMode && isSelectedForMerge && (
          <div className="absolute inset-0 bg-primary/20 flex items-center justify-center rounded-full">
            <CheckCircle2 className="h-10 w-10 text-primary drop-shadow-lg" />
          </div>
        )}
        {(person.imageCount ?? 0) > 0 && !mergeMode && (
          <span className="absolute bottom-1 right-1 min-w-5 h-5 flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold shadow-sm">{person.imageCount}</span>
        )}
      </button>

      <p className="mt-2 text-sm font-medium text-foreground text-center truncate w-full">{person.name || `Person ${person.person_id}`}</p>
      <p className="text-xs text-muted-foreground">{person.imageCount ?? 0} photo{(person.imageCount ?? 0) !== 1 ? 's' : ''}</p>

      {expanded && !mergeMode && (
        <div className="mt-3 w-full space-y-3 p-3 rounded-xl border border-border bg-card shadow-md animate-in fade-in-0 zoom-in-95 duration-200">
          {editing ? (
            <div className="space-y-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Enter name" className="text-sm h-8" />
              <div className="flex gap-1">
                <Button onClick={handleSave} size="sm" className="flex-1 h-7 text-xs">Save</Button>
                <Button onClick={() => setEditing(false)} variant="ghost" size="sm" className="h-7 text-xs">Cancel</Button>
              </div>
            </div>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)} className="w-full h-7 text-xs">
              {person.name ? "Edit Name" : "Add Name"}
            </Button>
          )}

          {person.qr_code ? (
            <div className="space-y-2">
              {person.qr_url && (
                <img src={person.qr_url} alt="QR Code" className="w-full rounded-lg" />
              )}
              <div className="space-y-1.5">
                <Button size="sm" variant="outline" onClick={handleCopyCode} className="w-full h-7 text-xs">
                  {copied ? <Check className="mr-1 h-3 w-3" /> : <Copy className="mr-1 h-3 w-3" />}
                  {copied ? "Copied!" : "Copy Code"}
                </Button>
                <Button size="sm" variant="outline" onClick={handleCopyLink} className="w-full h-7 text-xs">
                  <Copy className="mr-1 h-3 w-3" />Copy Link
                </Button>
              </div>
            </div>
          ) : (
            <Button onClick={() => onGenerateQR(person.id)} disabled={!person.name} className="w-full h-7 text-xs" size="sm">
              <QrCode className="mr-1 h-3 w-3" />Generate QR
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            className="w-full h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={() => onDeletePerson(person.id, person.name || `Person ${person.person_id}`)}
          >
            <Trash2 className="mr-1 h-3 w-3" />Remove Person
          </Button>
        </div>
      )}

      {/* Photos Modal */}
      <PersonPhotosModal person={person} open={showPhotos} onClose={() => setShowPhotos(false)} />
    </div>
  );
}