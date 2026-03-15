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
  BarChart3, CheckCircle2, XCircle, Loader2, RefreshCw, AlertTriangle, ArrowRight, Copy, Check, Merge, Trash2, Sparkles,
} from "lucide-react";
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

      const personsWithImages = await Promise.all(
        (data || []).map(async (person) => {
          const { data: images, count } = await supabase
            .from("person_images")
            .select("image_url", { count: "exact" })
            .eq("person_id", person.id);
          return { ...person, previewImage: images?.[0]?.image_url || null, imageCount: count || 0 };
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
      const { data, error } = await supabase.functions.invoke("cluster-faces", { body });
      if (error) throw error;
      toast({
        title: "Clustering complete!",
        description: data?.mergeStats
          ? `${data.message}. AI merged ${data.mergeStats.beforeMerge - data.mergeStats.afterMerge} duplicate(s).`
          : data?.message || "Faces have been grouped.",
      });
      await supabase.from("events").update({ status: "ready" }).eq("id", eventId);
      fetchEvent();
      await fetchPersons();
      setSimilarGroups([]);
      setActiveTab("persons");
    } catch (error: any) {
      toast({ variant: "destructive", title: "Clustering failed", description: getSafeErrorMessage(error) });
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

                      {!uploading && (
                        <Button onClick={() => setActiveTab("cluster")} className="w-full">
                          Go to Clustering <ArrowRight className="ml-2 h-4 w-4" />
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
                    <ImageIcon className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
                    <p className="text-muted-foreground mb-6">
                      {uploadedImageUrls.length > 0 
                        ? `${uploadedImageUrls.length} new photos ready to cluster`
                        : event.status === 'created' 
                          ? 'Upload photos first, then come back here to cluster'
                          : 'Click below to run (or re-run) face clustering on all uploaded photos'}
                    </p>
                    <Button onClick={handleCluster} disabled={clustering} size="lg">
                      {clustering ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Clustering...</> : "Start Clustering"}
                    </Button>
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
                                  <img src={p.previewImage} alt={p.name || ''} className="w-full h-full object-cover" />
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
          <img src={person.previewImage} alt={person.name || `Person ${person.person_id}`} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110" />
        ) : (
          <div className="flex items-center justify-center h-full bg-muted"><Users className="h-10 w-10 text-muted-foreground" /></div>
        )}
        {!mergeMode && (
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 rounded-full" />
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
    </div>
  );
}
