import { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { 
  Download, Share2, X, ZoomIn, ZoomOut, Play, Pause, 
  ChevronLeft, ChevronRight, Check, Filter, 
  Heart, Clock, Users, User, Smile, Grid, Image as ImageIcon,
  Facebook, Twitter, Link2, Sparkles
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { getSafeErrorMessage } from "@/lib/error-handler";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ImageData {
  id: string;
  url: string;
  face_count: number;
  moment_type: string;
  smile_score: number;
  captured_at: string;
}

interface PersonData {
  id: string;
  name: string;
  eventId: string;
  images: ImageData[];
}

type FilterType = "none" | "grayscale" | "sepia" | "brightness" | "contrast" | "blur";
type SmartFilter = "all" | "solo" | "duo" | "group" | "best-smile" | "favorites";
type ViewMode = "grid" | "timeline";

interface MomentGroup {
  label: string;
  icon: React.ReactNode;
  images: ImageData[];
}

const filterStyles: Record<FilterType, string> = {
  none: "", grayscale: "grayscale(100%)", sepia: "sepia(100%)",
  brightness: "brightness(1.3)", contrast: "contrast(1.3)", blur: "blur(2px)",
};

const momentIcons: Record<string, React.ReactNode> = {
  arrival: <Clock className="h-4 w-4" />, group: <Users className="h-4 w-4" />,
  candid: <Sparkles className="h-4 w-4" />, farewell: <Heart className="h-4 w-4" />,
};

const momentLabels: Record<string, string> = {
  arrival: "Arrival", group: "Group Photos", candid: "Candid Moments", farewell: "Farewell",
};

export default function Gallery() {
  const { eventId, personId, token, qrCode } = useParams();
  const { user } = useAuth();
  const [personData, setPersonData] = useState<PersonData | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [selectedImage, setSelectedImage] = useState<ImageData | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [zoom, setZoom] = useState(1);
  const [filter, setFilter] = useState<FilterType>("none");
  const [smartFilter, setSmartFilter] = useState<SmartFilter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [slideshowActive, setSlideshowActive] = useState(false);
  const [selectedImages, setSelectedImages] = useState<Set<number>>(new Set());
  const [bulkMode, setBulkMode] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  const parseQrCode = useCallback(() => {
    if (qrCode) {
      const parts = qrCode.split('_');
      if (parts.length >= 3) return { eventId: parts[0], personId: parts[1], accessToken: parts.slice(2).join('_') };
      return { eventId: null, personId: null, accessToken: null };
    }
    return { eventId, personId, accessToken: token };
  }, [qrCode, eventId, personId, token]);

  useEffect(() => {
    const parsed = parseQrCode();
    if (parsed.eventId && parsed.personId && parsed.accessToken) {
      fetchPersonData(parsed.eventId, parsed.personId, parsed.accessToken);
      fetchFavorites();
    } else {
      setLoading(false);
      setAccessDenied(true);
      if (!parsed.accessToken && parsed.eventId) {
        toast({ variant: "destructive", title: "Invalid QR code", description: "This QR code is outdated. Please request a new one." });
      }
    }
  }, [qrCode, eventId, personId, token]);

  useEffect(() => {
    if (!slideshowActive || !personData) return;
    const filteredImages = getFilteredImages();
    const interval = setInterval(() => {
      setSelectedIndex(prev => { const next = (prev + 1) % filteredImages.length; setSelectedImage(filteredImages[next]); return next; });
    }, 3000);
    return () => clearInterval(interval);
  }, [slideshowActive, personData, smartFilter]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedImage || !personData) return;
      if (e.key === "ArrowLeft") navigateImage(-1);
      else if (e.key === "ArrowRight") navigateImage(1);
      else if (e.key === "Escape") { setSelectedImage(null); setSlideshowActive(false); }
      else if (e.key === "+" || e.key === "=") setZoom(prev => Math.min(prev + 0.25, 3));
      else if (e.key === "-") setZoom(prev => Math.max(prev - 0.25, 0.5));
      else if (e.key === "f" || e.key === "F") toggleFavorite(selectedImage);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedImage, personData, selectedIndex, favorites]);

  const fetchPersonData = async (evtId: string, perId: string, accessTkn: string) => {
    try {
      // Use the RPC function for secure access validation
      const { data: validationData, error: validationError } = await supabase
        .rpc("validate_person_access", {
          p_event_id: evtId,
          p_person_id: parseInt(perId),
          p_access_token: accessTkn,
        });

      if (validationError || !validationData || validationData.length === 0) {
        setAccessDenied(true);
        toast({ variant: "destructive", title: "Access denied", description: "Invalid or expired QR code." });
        setLoading(false);
        return;
      }

      const person = validationData[0];

      // Track QR scan
      try {
        await supabase.from("analytics_events").insert({
          event_id: evtId,
          person_id: person.id,
          event_type: "qr_scan",
          metadata: { user_agent: navigator.userAgent, timestamp: new Date().toISOString() },
        });
      } catch {}

      // Get person images using the RPC for secure gallery access
      const { data: galleryData, error: galleryError } = await supabase
        .rpc("get_person_gallery", {
          p_event_id: evtId,
          p_person_id: parseInt(perId),
          p_access_token: accessTkn,
        });

      const sortedImages: ImageData[] = (galleryData || [])
        .filter((img: any) => img.image_url)
        .map((img: any) => ({
          id: img.image_id,
          url: img.image_url,
          face_count: img.face_count || 1,
          moment_type: img.moment_type || "candid",
          smile_score: img.smile_score || 0.5,
          captured_at: img.captured_at || new Date().toISOString(),
        }));

      setPersonData({
        id: person.id,
        name: person.name || "Unknown",
        eventId: evtId,
        images: sortedImages,
      });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error loading photos", description: getSafeErrorMessage(error) });
      setAccessDenied(true);
    } finally {
      setLoading(false);
    }
  };

  const fetchFavorites = async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase.from("favorites").select("image_url").eq("user_id", user.id);
      if (error) throw error;
      setFavorites(new Set((data || []).map(f => f.image_url)));
    } catch (error) { console.error("Error fetching favorites:", error); }
  };

  const toggleFavorite = async (image: ImageData) => {
    if (!user || !personData) {
      toast({ variant: "destructive", title: "Sign in required", description: "Please sign in to save favorites" });
      return;
    }
    const isFavorite = favorites.has(image.url);
    try {
      if (isFavorite) {
        await supabase.from("favorites").delete().eq("user_id", user.id).eq("image_url", image.url);
        setFavorites(prev => { const next = new Set(prev); next.delete(image.url); return next; });
        toast({ title: "Removed from favorites" });
      } else {
        await supabase.from("favorites").insert({ user_id: user.id, person_id: personData.id, image_url: image.url });
        setFavorites(prev => new Set(prev).add(image.url));
        toast({ title: "Added to favorites ❤️" });
      }
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: getSafeErrorMessage(error) });
    }
  };

  const getFilteredImages = useCallback((): ImageData[] => {
    if (!personData) return [];
    switch (smartFilter) {
      case "solo": return personData.images.filter(img => img.face_count === 1);
      case "duo": return personData.images.filter(img => img.face_count === 2);
      case "group": return personData.images.filter(img => img.face_count >= 3);
      case "best-smile": return [...personData.images].sort((a, b) => b.smile_score - a.smile_score).slice(0, 10);
      case "favorites": return personData.images.filter(img => favorites.has(img.url));
      default: return personData.images;
    }
  }, [personData, smartFilter, favorites]);

  const getTimelineGroups = useCallback((): MomentGroup[] => {
    if (!personData) return [];
    const groups: Record<string, ImageData[]> = { arrival: [], group: [], candid: [], farewell: [] };
    personData.images.forEach(img => {
      const type = img.moment_type || 'candid';
      if (groups[type]) groups[type].push(img); else groups.candid.push(img);
    });
    return Object.entries(groups).filter(([_, images]) => images.length > 0).map(([type, images]) => ({
      label: momentLabels[type] || type, icon: momentIcons[type] || <ImageIcon className="h-4 w-4" />, images,
    }));
  }, [personData]);

  const navigateImage = useCallback((direction: number) => {
    const filteredImages = getFilteredImages();
    if (filteredImages.length === 0) return;
    const newIndex = (selectedIndex + direction + filteredImages.length) % filteredImages.length;
    setSelectedIndex(newIndex);
    setSelectedImage(filteredImages[newIndex]);
  }, [selectedIndex, getFilteredImages]);

  const handleImageClick = (image: ImageData, index: number) => {
    if (bulkMode) { toggleImageSelection(index); } else { setSelectedImage(image); setSelectedIndex(index); setZoom(1); }
  };

  const toggleImageSelection = (index: number) => {
    setSelectedImages(prev => { const newSet = new Set(prev); if (newSet.has(index)) newSet.delete(index); else newSet.add(index); return newSet; });
  };

  const selectAll = () => { setSelectedImages(new Set(getFilteredImages().map((_, i) => i))); };
  const deselectAll = () => { setSelectedImages(new Set()); };

  const handleDownload = async (url: string, filename?: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename || `FaceTag-photo-${Date.now()}.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);

      if (personData) {
        try { await supabase.from("analytics_events").insert({ event_id: personData.eventId, person_id: personData.id, event_type: "photo_download", metadata: { image_url: url, timestamp: new Date().toISOString() } }); } catch {}
      }
      toast({ title: "Download started", description: "Your HD photo is being downloaded" });
    } catch {
      const link = document.createElement('a');
      link.href = url; link.download = filename || 'photo.jpg'; link.target = '_blank'; link.click();
    }
  };

  const handleDownloadAll = async () => {
    const filtered = getFilteredImages();
    if (filtered.length === 0) return;
    toast({ title: "Preparing download", description: `Downloading ${filtered.length} HD photos...` });
    filtered.forEach((img, index) => { setTimeout(() => { handleDownload(img.url, `FaceTag-${personData?.name}-${index + 1}.jpg`); }, index * 800); });
  };

  const handleDownloadSelected = () => {
    const filtered = getFilteredImages();
    if (selectedImages.size === 0) return;
    toast({ title: "Preparing download", description: `Downloading ${selectedImages.size} HD photos...` });
    Array.from(selectedImages).forEach((index, i) => { setTimeout(() => { handleDownload(filtered[index].url, `FaceTag-${personData?.name}-${index + 1}.jpg`); }, i * 800); });
  };

  const handleShare = (url: string, platform?: string) => {
    const shareText = `Check out my photo from ${personData?.name}'s gallery on FaceTag!`;
    const encodedUrl = encodeURIComponent(url);
    const encodedText = encodeURIComponent(shareText);
    switch (platform) {
      case 'facebook': window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`, '_blank'); break;
      case 'twitter': window.open(`https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`, '_blank'); break;
      case 'whatsapp': window.open(`https://wa.me/?text=${encodedText}%20${encodedUrl}`, '_blank'); break;
      default:
        if (navigator.share) {
          navigator.share({ title: 'My Photo from FaceTag', text: shareText, url }).catch(() => { navigator.clipboard.writeText(url); toast({ title: "Link copied", description: "Photo link copied to clipboard" }); });
        } else { navigator.clipboard.writeText(url); toast({ title: "Link copied", description: "Photo link copied to clipboard" }); }
    }
  };

  const startSlideshow = () => {
    const filtered = getFilteredImages();
    if (filtered.length === 0) return;
    setSelectedImage(filtered[0]); setSelectedIndex(0); setSlideshowActive(true);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background"><Navbar />
        <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
          <div className="relative w-12 h-12">
            <div className="absolute inset-0 rounded-full border-2 border-primary/20 animate-ping" />
            <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary animate-spin" />
          </div>
        </div>
      </div>
    );
  }

  if (accessDenied || !personData) {
    return (
      <div className="min-h-screen bg-background"><Navbar />
        <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
          <div className="text-center max-w-md">
            <X className="h-16 w-16 mx-auto text-destructive mb-4" />
            <h2 className="text-2xl font-bold mb-2">Access Denied</h2>
            <p className="text-muted-foreground mb-6">This QR code is invalid or expired. Please scan a valid QR code to access your photos.</p>
          </div>
        </div>
      </div>
    );
  }

  const filteredImages = getFilteredImages();
  const timelineGroups = getTimelineGroups();

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-3xl font-black text-foreground tracking-tight mb-1">
                {personData.name}&apos;s Photos
              </h1>
              <p className="text-muted-foreground text-sm">
                {personData.images.length} photo{personData.images.length !== 1 ? "s" : ""} found · {personData.eventId ? "" : ""}
              </p>
            </div>
          </div>
          {/* Activity score */}
          <div className="mt-4 p-4 rounded-2xl bg-gradient-to-r from-primary/8 to-transparent border border-primary/10 flex flex-wrap items-center gap-6">
            {[
              { n: personData.images.length, l: "Your photos" },
              { n: personData.images.filter(i => i.face_count === 1).length, l: "Solo shots" },
              { n: personData.images.filter(i => i.face_count >= 2).length, l: "Group shots" },
              { n: favorites.size, l: "Favorites" },
            ].map(s => (
              <div key={s.l} className="text-center min-w-[60px]">
                <div className="text-2xl font-black text-primary">{s.n}</div>
                <div className="text-xs text-muted-foreground">{s.l}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap gap-2 mb-6">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm"><Filter className="h-4 w-4 mr-2" />Filter: {smartFilter}</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Smart Filters</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {(["all", "solo", "duo", "group", "best-smile", "favorites"] as SmartFilter[]).map(f => (
                <DropdownMenuItem key={f} onClick={() => setSmartFilter(f)}>
                  {f === "all" && <Grid className="h-4 w-4 mr-2" />}
                  {f === "solo" && <User className="h-4 w-4 mr-2" />}
                  {f === "duo" && <Users className="h-4 w-4 mr-2" />}
                  {f === "group" && <Users className="h-4 w-4 mr-2" />}
                  {f === "best-smile" && <Smile className="h-4 w-4 mr-2" />}
                  {f === "favorites" && <Heart className="h-4 w-4 mr-2" />}
                  {f.charAt(0).toUpperCase() + f.slice(1).replace('-', ' ')}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="outline" size="sm" onClick={() => setViewMode(viewMode === "grid" ? "timeline" : "grid")}>
            {viewMode === "grid" ? <Clock className="h-4 w-4 mr-2" /> : <Grid className="h-4 w-4 mr-2" />}
            {viewMode === "grid" ? "Timeline" : "Grid"}
          </Button>

          <Button variant="outline" size="sm" onClick={startSlideshow}>
            <Play className="h-4 w-4 mr-2" />Slideshow
          </Button>

          <Button variant="outline" size="sm" onClick={() => { setBulkMode(!bulkMode); setSelectedImages(new Set()); }}>
            <Check className="h-4 w-4 mr-2" />{bulkMode ? "Cancel" : "Select"}
          </Button>

          {bulkMode && selectedImages.size > 0 && (
            <Button size="sm" onClick={handleDownloadSelected}>
              <Download className="h-4 w-4 mr-2" />Download ({selectedImages.size})
            </Button>
          )}

          {bulkMode && (
            <>
              <Button variant="ghost" size="sm" onClick={selectAll}>Select All</Button>
              <Button variant="ghost" size="sm" onClick={deselectAll}>Deselect</Button>
            </>
          )}

          <Button variant="outline" size="sm" onClick={handleDownloadAll}>
            <Download className="h-4 w-4 mr-2" />Download All
          </Button>
        </div>

        {/* Pinterest Masonry Grid */}
        {viewMode === "grid" ? (
          <div className="columns-2 sm:columns-3 md:columns-4 lg:columns-5 gap-3 space-y-0">
            {filteredImages.map((image, index) => (
              <div
                key={image.id}
                className={cn(
                  "relative group break-inside-avoid mb-3 rounded-xl overflow-hidden cursor-pointer border-2 transition-all hover:shadow-xl",
                  bulkMode && selectedImages.has(index) ? "border-primary ring-2 ring-primary/30" : "border-transparent"
                )}
                onClick={() => handleImageClick(image, index)}
              >
                <img
                  src={image.url}
                  alt={`Photo ${index + 1}`}
                  className="w-full h-auto block transition-transform duration-300 group-hover:scale-[1.02]"
                  loading="lazy"
                  style={{ display: "block" }}
                />
                {/* Overlay on hover */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                  <div className="absolute bottom-2 left-2 right-2 flex justify-between items-end">
                    <span className="text-white/80 text-xs bg-black/40 backdrop-blur-sm px-2 py-0.5 rounded-full">
                      {image.face_count === 1 ? "Solo" : image.face_count === 2 ? "Duo" : `${image.face_count} people`}
                    </span>
                    <div className="flex gap-1">
                      <button
                        className="h-7 w-7 text-white bg-black/30 hover:bg-black/50 backdrop-blur-sm rounded-full flex items-center justify-center transition-colors"
                        onClick={e => { e.stopPropagation(); toggleFavorite(image); }}
                      >
                        <Heart className={cn("h-3.5 w-3.5", favorites.has(image.url) && "fill-red-400 text-red-400")} />
                      </button>
                      <button
                        className="h-7 w-7 text-white bg-black/30 hover:bg-black/50 backdrop-blur-sm rounded-full flex items-center justify-center transition-colors"
                        onClick={e => { e.stopPropagation(); handleDownload(image.url); }}
                      >
                        <Download className="h-3.5 w-3.5" />
                      </button>
                      <button
                        className="h-7 w-7 text-green-400 bg-black/30 hover:bg-green-500/30 backdrop-blur-sm rounded-full flex items-center justify-center transition-colors"
                        onClick={e => { e.stopPropagation(); handleShare(image.url, 'whatsapp'); }}
                      >
                        <Share2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
                {bulkMode && selectedImages.has(index) && (
                  <div className="absolute top-2 right-2 h-6 w-6 bg-primary rounded-full flex items-center justify-center shadow-lg">
                    <Check className="h-3.5 w-3.5 text-primary-foreground" />
                  </div>
                )}
                {favorites.has(image.url) && !bulkMode && (
                  <div className="absolute top-2 right-2 h-5 w-5 flex items-center justify-center">
                    <Heart className="h-3.5 w-3.5 fill-red-400 text-red-400 drop-shadow" />
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-8">
            {timelineGroups.map((group, groupIndex) => (
              <div key={groupIndex}>
                <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">{group.icon}{group.label}<Badge variant="secondary">{group.images.length}</Badge></h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                  {group.images.map((image, index) => (
                    <div key={image.id} className="relative group aspect-square rounded-xl overflow-hidden cursor-pointer border-2 border-transparent transition-all hover:shadow-lg" onClick={() => { setSelectedImage(image); setSelectedIndex(index); setZoom(1); }}>
                      <img src={image.url} alt={`Photo`} className="w-full h-full object-cover transition-transform group-hover:scale-105" loading="lazy" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {filteredImages.length === 0 && (
          <div className="text-center py-16">
            <ImageIcon className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-xl font-semibold mb-2">No photos found</h3>
            <p className="text-muted-foreground">Try a different filter</p>
          </div>
        )}
      </div>

      {/* Lightbox */}
      <Dialog open={!!selectedImage} onOpenChange={(open) => { if (!open) { setSelectedImage(null); setSlideshowActive(false); } }}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] p-0 bg-black/95 border-none">
          {selectedImage && (
            <div className="relative w-full h-[90vh] flex items-center justify-center">
              <img src={selectedImage.url} alt="Full size" className="max-w-full max-h-full object-contain transition-transform" style={{ transform: `scale(${zoom})`, filter: filterStyles[filter] }} />

              <div className="absolute top-4 right-4 flex gap-2">
                <Button size="icon" variant="ghost" className="text-white hover:bg-white/20" onClick={() => toggleFavorite(selectedImage)}>
                  <Heart className={cn("h-5 w-5", favorites.has(selectedImage.url) && "fill-red-500 text-red-500")} />
                </Button>
                <Button size="icon" variant="ghost" className="text-white hover:bg-white/20" onClick={() => handleDownload(selectedImage.url)}>
                  <Download className="h-5 w-5" />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon" variant="ghost" className="text-white hover:bg-white/20"><Share2 className="h-5 w-5" /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onClick={() => handleShare(selectedImage.url, 'facebook')}><Facebook className="h-4 w-4 mr-2" />Facebook</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleShare(selectedImage.url, 'twitter')}><Twitter className="h-4 w-4 mr-2" />Twitter</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleShare(selectedImage.url, 'whatsapp')}><Share2 className="h-4 w-4 mr-2" />WhatsApp</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => handleShare(selectedImage.url)}><Link2 className="h-4 w-4 mr-2" />Copy Link</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3">
                <Button size="icon" variant="ghost" className="text-white hover:bg-white/20" onClick={() => navigateImage(-1)}>
                  <ChevronLeft className="h-6 w-6" />
                </Button>
                <Button size="icon" variant="ghost" className="text-white hover:bg-white/20" onClick={() => setSlideshowActive(!slideshowActive)}>
                  {slideshowActive ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                </Button>
                <Button size="icon" variant="ghost" className="text-white hover:bg-white/20" onClick={() => navigateImage(1)}>
                  <ChevronRight className="h-6 w-6" />
                </Button>
              </div>

              <div className="absolute bottom-4 right-4 flex items-center gap-2">
                <Button size="icon" variant="ghost" className="text-white hover:bg-white/20" onClick={() => setZoom(prev => Math.max(prev - 0.25, 0.5))}>
                  <ZoomOut className="h-5 w-5" />
                </Button>
                <span className="text-white text-sm min-w-[3rem] text-center">{Math.round(zoom * 100)}%</span>
                <Button size="icon" variant="ghost" className="text-white hover:bg-white/20" onClick={() => setZoom(prev => Math.min(prev + 0.25, 3))}>
                  <ZoomIn className="h-5 w-5" />
                </Button>
              </div>

              <div className="absolute bottom-4 left-4">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="text-white hover:bg-white/20">Filter: {filter}</Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {(Object.keys(filterStyles) as FilterType[]).map(f => (
                      <DropdownMenuItem key={f} onClick={() => setFilter(f)}>{f.charAt(0).toUpperCase() + f.slice(1)}</DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <p className="absolute top-4 left-4 text-white/70 text-sm">
                {selectedIndex + 1} / {filteredImages.length}
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}