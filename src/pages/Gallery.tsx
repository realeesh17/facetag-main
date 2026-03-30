import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import {
  Download, Share2, X, ZoomIn, ZoomOut, Play, Pause,
  ChevronLeft, ChevronRight, Check, Heart, Users, User,
  Smile, Grid, Image as ImageIcon, Facebook, Twitter,
  Link2, Filter, MessageCircle, Camera
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { getSafeErrorMessage } from "@/lib/error-handler";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel,
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
  eventName: string;
  images: ImageData[];
  totalEventPhotos: number;
}

type FilterType = "none" | "grayscale" | "sepia" | "brightness" | "contrast";
type SmartFilter = "all" | "solo" | "group" | "best-smile" | "favorites";

const filterStyles: Record<FilterType, string> = {
  none: "", grayscale: "grayscale(100%)", sepia: "sepia(100%)",
  brightness: "brightness(1.3)", contrast: "contrast(1.3)",
};

export default function Gallery() {
  const { eventId, personId, token, qrCode } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [personData, setPersonData] = useState<PersonData | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [selectedImage, setSelectedImage] = useState<ImageData | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [filter, setFilter] = useState<FilterType>("none");
  const [smartFilter, setSmartFilter] = useState<SmartFilter>("all");
  const [slideshowActive, setSlideshowActive] = useState(false);
  const [selectedImages, setSelectedImages] = useState<Set<number>>(new Set());
  const [bulkMode, setBulkMode] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [activityScore, setActivityScore] = useState<number>(0);
  const { toast } = useToast();

  const parseQrCode = useCallback(() => {
    if (qrCode) {
      const parts = qrCode.split("_");
      if (parts.length >= 3) return { evtId: parts[0], perId: parts[1], tkn: parts.slice(2).join("_") };
      return { evtId: null, perId: null, tkn: null };
    }
    return { evtId: eventId || null, perId: personId || null, tkn: token || null };
  }, [qrCode, eventId, personId, token]);

  useEffect(() => {
    const { evtId, perId, tkn } = parseQrCode();
    if (evtId && perId && tkn) {
      fetchPersonData(evtId, perId, tkn);
    } else {
      setLoading(false);
      setAccessDenied(true);
    }
  }, [qrCode, eventId, personId, token]);

  useEffect(() => {
    if (!slideshowActive || !personData) return;
    const filtered = getFilteredImages();
    const interval = setInterval(() => {
      setSelectedIndex(prev => {
        const next = (prev + 1) % filtered.length;
        setSelectedImage(filtered[next]);
        return next;
      });
    }, 3000);
    return () => clearInterval(interval);
  }, [slideshowActive, personData, smartFilter]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!selectedImage) return;
      if (e.key === "ArrowLeft") navigateImage(-1);
      else if (e.key === "ArrowRight") navigateImage(1);
      else if (e.key === "Escape") { setSelectedImage(null); setSlideshowActive(false); }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [selectedImage, selectedIndex]);

  const fetchPersonData = async (evtId: string, perId: string, tkn: string) => {
    try {
      let person: { id: string; name: string } | null = null;

      // Try RPC first, then direct fallback
      try {
        const { data } = await supabase.rpc("validate_person_access", {
          p_event_id: evtId, p_person_id: parseInt(perId), p_access_token: tkn,
        });
        if (data && data.length > 0) person = { id: data[0].id, name: data[0].name };
      } catch {}

      if (!person) {
        const { data } = await supabase.from("persons").select("id, name")
          .eq("event_id", evtId).eq("person_id", parseInt(perId))
          .eq("access_token", tkn).not("qr_code", "is", null).maybeSingle();
        if (data) person = { id: data.id, name: data.name };
      }

      if (!person) { setAccessDenied(true); setLoading(false); return; }

      // Get event name and total photos
      const { data: eventData } = await supabase.from("events").select("name").eq("id", evtId).single();
      const { count: totalPhotos } = await supabase.from("person_images")
        .select("id", { count: "exact", head: true })
        .in("person_id", (await supabase.from("persons").select("id").eq("event_id", evtId)).data?.map(p => p.id) || []);

      // Get person images
      const { data: images } = await supabase
        .from("person_images")
        .select("id, image_url, face_count, moment_type, smile_score, captured_at, created_at")
        .eq("person_id", person.id)
        .order("created_at", { ascending: true });

      const photoList: ImageData[] = (images || [])
        .filter((img: any) => img.image_url)
        .map((img: any) => ({
          id: img.id, url: img.image_url,
          face_count: img.face_count || 1,
          moment_type: img.moment_type || "candid",
          smile_score: img.smile_score || 0.5,
          captured_at: img.captured_at || img.created_at,
        }));

      // Calculate activity score (% of total event photos this person appears in)
      const score = totalPhotos && totalPhotos > 0
        ? Math.round((photoList.length / totalPhotos) * 100)
        : 0;
      setActivityScore(score);

      setPersonData({
        id: person.id,
        name: person.name || "Unknown",
        eventId: evtId,
        eventName: eventData?.name || "Event",
        images: photoList,
        totalEventPhotos: totalPhotos || 0,
      });

      // Track scan
      try {
        await supabase.from("analytics_events").insert({
          event_id: evtId, person_id: person.id,
          event_type: "qr_scan", metadata: { timestamp: new Date().toISOString() },
        });
      } catch {}

      // Load favorites
      if (user) {
        const { data: favData } = await supabase.from("favorites").select("image_url").eq("user_id", user.id);
        setFavorites(new Set((favData || []).map((f: any) => f.image_url)));
      }

    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: getSafeErrorMessage(error) });
      setAccessDenied(true);
    } finally {
      setLoading(false);
    }
  };

  const toggleFavorite = async (image: ImageData) => {
    if (!user || !personData) { toast({ title: "Sign in to save favorites" }); return; }
    const isFav = favorites.has(image.url);
    if (isFav) {
      await supabase.from("favorites").delete().eq("user_id", user.id).eq("image_url", image.url);
      setFavorites(prev => { const n = new Set(prev); n.delete(image.url); return n; });
      toast({ title: "Removed from favorites" });
    } else {
      await supabase.from("favorites").insert({ user_id: user.id, person_id: personData.id, image_url: image.url });
      setFavorites(prev => new Set(prev).add(image.url));
      toast({ title: "Added to favorites ❤️" });
    }
  };

  const getFilteredImages = useCallback((): ImageData[] => {
    if (!personData) return [];
    switch (smartFilter) {
      case "solo": return personData.images.filter(i => i.face_count === 1);
      case "group": return personData.images.filter(i => i.face_count >= 2);
      case "best-smile": return [...personData.images].sort((a, b) => b.smile_score - a.smile_score).slice(0, 10);
      case "favorites": return personData.images.filter(i => favorites.has(i.url));
      default: return personData.images;
    }
  }, [personData, smartFilter, favorites]);

  const navigateImage = useCallback((dir: number) => {
    const filtered = getFilteredImages();
    if (!filtered.length) return;
    const next = (selectedIndex + dir + filtered.length) % filtered.length;
    setSelectedIndex(next);
    setSelectedImage(filtered[next]);
  }, [selectedIndex, getFilteredImages]);

  const handleDownload = async (url: string, filename?: string) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename || `FaceTag-${Date.now()}.jpg`;
      a.click();
      toast({ title: "Download started ✓" });
    } catch { window.open(url, "_blank"); }
  };

  const handleShare = (url: string, platform?: string) => {
    const text = `Check out my photo from ${personData?.name}'s gallery on FaceTag!`;
    if (platform === "whatsapp") window.open(`https://wa.me/?text=${encodeURIComponent(text + " " + url)}`, "_blank");
    else if (platform === "facebook") window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, "_blank");
    else if (platform === "twitter") window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, "_blank");
    else if (platform === "instagram") {
      navigator.clipboard.writeText(url);
      toast({ title: "Link copied!", description: "Paste it in your Instagram story or post" });
    } else {
      navigator.clipboard.writeText(url);
      toast({ title: "Link copied ✓" });
    }
  };

  const shareAllPhotos = (platform: string) => {
    const galleryUrl = window.location.href;
    const text = `🎉 Check out my photos from ${personData?.eventName} on FaceTag! I appear in ${personData?.images.length} photos!`;
    if (platform === "whatsapp") window.open(`https://wa.me/?text=${encodeURIComponent(text + " " + galleryUrl)}`, "_blank");
    else if (platform === "facebook") window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(galleryUrl)}`, "_blank");
    else if (platform === "twitter") window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(galleryUrl)}`, "_blank");
    else { navigator.clipboard.writeText(galleryUrl); toast({ title: "Gallery link copied ✓" }); }
  };

  const filteredImages = getFilteredImages();

  if (loading) return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground">Loading your photos...</p>
        </div>
      </div>
    </div>
  );

  if (accessDenied || !personData) return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
        <div className="text-center max-w-md px-4">
          <X className="h-16 w-16 mx-auto text-destructive mb-4" />
          <h2 className="text-2xl font-bold mb-2">Access Denied</h2>
          <p className="text-muted-foreground mb-6">This QR code is invalid or expired.</p>
          <Button onClick={() => navigate("/user/scan")}>Scan Another Code</Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto px-4 py-8">

        {/* Header */}
        <div className="mb-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold mb-1">{personData.name}'s Gallery</h1>
              <p className="text-muted-foreground text-sm">{personData.eventName}</p>
            </div>
            {/* Share Gallery Button */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Share2 className="h-4 w-4 mr-2" />Share My Gallery
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Share Your Gallery</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => shareAllPhotos("whatsapp")}>
                  <MessageCircle className="h-4 w-4 mr-2 text-green-500" />WhatsApp
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => shareAllPhotos("facebook")}>
                  <Facebook className="h-4 w-4 mr-2 text-blue-600" />Facebook
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => shareAllPhotos("twitter")}>
                  <Twitter className="h-4 w-4 mr-2 text-sky-500" />Twitter / X
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => shareAllPhotos("copy")}>
                  <Link2 className="h-4 w-4 mr-2" />Copy Link
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* User Activity Score */}
          <div className="mt-4 p-4 rounded-2xl bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/20">
            <div className="flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
                  <Camera className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-primary">{personData.images.length}</p>
                  <p className="text-xs text-muted-foreground">Your photos</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
                  <Users className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-primary">{personData.totalEventPhotos}</p>
                  <p className="text-xs text-muted-foreground">Total event photos</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
                  <Smile className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-primary">{activityScore}%</p>
                  <p className="text-xs text-muted-foreground">You're in {activityScore}% of photos!</p>
                </div>
              </div>
              {/* Activity bar */}
              <div className="flex-1 min-w-[120px]">
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>Your presence</span>
                  <span>{activityScore}%</span>
                </div>
                <div className="w-full bg-primary/10 rounded-full h-2">
                  <div
                    className="bg-primary h-2 rounded-full transition-all duration-1000"
                    style={{ width: `${activityScore}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap gap-2 mb-6">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Filter className="h-4 w-4 mr-2" />Filter: {smartFilter}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Smart Filters</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {(["all", "solo", "group", "best-smile", "favorites"] as SmartFilter[]).map(f => (
                <DropdownMenuItem key={f} onClick={() => setSmartFilter(f)}>
                  {f === "all" && <Grid className="h-4 w-4 mr-2" />}
                  {f === "solo" && <User className="h-4 w-4 mr-2" />}
                  {f === "group" && <Users className="h-4 w-4 mr-2" />}
                  {f === "best-smile" && <Smile className="h-4 w-4 mr-2" />}
                  {f === "favorites" && <Heart className="h-4 w-4 mr-2" />}
                  {f === "all" ? `All (${personData.images.length})` :
                   f === "solo" ? `Solo (${personData.images.filter(i => i.face_count === 1).length})` :
                   f === "group" ? `Group (${personData.images.filter(i => i.face_count >= 2).length})` :
                   f === "best-smile" ? "Best Smiles" :
                   `Favorites (${favorites.size})`}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="outline" size="sm" onClick={() => { setBulkMode(!bulkMode); setSelectedImages(new Set()); }}>
            <Check className="h-4 w-4 mr-2" />{bulkMode ? "Cancel" : "Select"}
          </Button>

          {bulkMode && selectedImages.size > 0 && (
            <Button size="sm" onClick={() => Array.from(selectedImages).forEach((idx, i) =>
              setTimeout(() => handleDownload(filteredImages[idx].url, `photo-${idx + 1}.jpg`), i * 500)
            )}>
              <Download className="h-4 w-4 mr-2" />Download ({selectedImages.size})
            </Button>
          )}

          {bulkMode && (
            <>
              <Button variant="ghost" size="sm" onClick={() => setSelectedImages(new Set(filteredImages.map((_, i) => i)))}>Select All</Button>
              <Button variant="ghost" size="sm" onClick={() => setSelectedImages(new Set())}>Deselect</Button>
            </>
          )}

          <Button variant="outline" size="sm" onClick={() =>
            filteredImages.forEach((img, i) => setTimeout(() => handleDownload(img.url, `${personData.name}-${i + 1}.jpg`), i * 600))
          }>
            <Download className="h-4 w-4 mr-2" />Download All
          </Button>
        </div>

        {/* Photo Grid */}
        {filteredImages.length === 0 ? (
          <div className="text-center py-16">
            <ImageIcon className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-xl font-semibold mb-2">No photos found</h3>
            <p className="text-muted-foreground">Try a different filter</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {filteredImages.map((image, index) => (
              <div
                key={image.id}
                className={cn("relative group aspect-square rounded-xl overflow-hidden cursor-pointer border-2 transition-all hover:shadow-lg",
                  bulkMode && selectedImages.has(index) ? "border-primary ring-2 ring-primary/30" : "border-transparent"
                )}
                onClick={() => {
                  if (bulkMode) {
                    setSelectedImages(prev => { const n = new Set(prev); n.has(index) ? n.delete(index) : n.add(index); return n; });
                  } else {
                    setSelectedImage(image); setSelectedIndex(index); setZoom(1);
                  }
                }}
              >
                <img src={image.url} alt={`Photo ${index + 1}`}
                  className="w-full h-full object-cover transition-transform group-hover:scale-105" loading="lazy" />

                {/* Hover overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="absolute bottom-2 left-2 right-2 flex justify-between items-end">
                    <Badge variant="secondary" className="text-xs bg-black/50 text-white border-0">
                      {image.face_count === 1 ? "Solo" : `${image.face_count} people`}
                    </Badge>
                    <div className="flex gap-1">
                      <button
                        className="p-1.5 bg-white/20 backdrop-blur rounded-full hover:bg-white/40 transition-colors"
                        onClick={e => { e.stopPropagation(); toggleFavorite(image); }}
                      >
                        <Heart className={cn("h-3.5 w-3.5 text-white", favorites.has(image.url) && "fill-red-400 text-red-400")} />
                      </button>
                      <button
                        className="p-1.5 bg-white/20 backdrop-blur rounded-full hover:bg-white/40 transition-colors"
                        onClick={e => { e.stopPropagation(); handleDownload(image.url); }}
                      >
                        <Download className="h-3.5 w-3.5 text-white" />
                      </button>
                      {/* WhatsApp share on each photo */}
                      <button
                        className="p-1.5 bg-green-500/80 backdrop-blur rounded-full hover:bg-green-500 transition-colors"
                        onClick={e => { e.stopPropagation(); handleShare(image.url, "whatsapp"); }}
                        title="Share on WhatsApp"
                      >
                        <MessageCircle className="h-3.5 w-3.5 text-white" />
                      </button>
                    </div>
                  </div>
                </div>

                {bulkMode && selectedImages.has(index) && (
                  <div className="absolute top-2 right-2 h-6 w-6 bg-primary rounded-full flex items-center justify-center">
                    <Check className="h-4 w-4 text-white" />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Lightbox */}
      <Dialog open={!!selectedImage} onOpenChange={open => { if (!open) { setSelectedImage(null); setSlideshowActive(false); } }}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] p-0 bg-black/95 border-none">
          {selectedImage && (
            <div className="relative w-full h-[90vh] flex items-center justify-center">
              <img src={selectedImage.url} alt="Full size"
                className="max-w-full max-h-full object-contain"
                style={{ transform: `scale(${zoom})`, filter: filterStyles[filter] }} />

              {/* Top controls */}
              <div className="absolute top-4 right-4 flex gap-2">
                <button className="p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors" onClick={() => toggleFavorite(selectedImage)}>
                  <Heart className={cn("h-5 w-5 text-white", favorites.has(selectedImage.url) && "fill-red-400 text-red-400")} />
                </button>
                <button className="p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors" onClick={() => handleDownload(selectedImage.url)}>
                  <Download className="h-5 w-5 text-white" />
                </button>
                {/* Share dropdown in lightbox */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors">
                      <Share2 className="h-5 w-5 text-white" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Share Photo</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => handleShare(selectedImage.url, "whatsapp")}>
                      <MessageCircle className="h-4 w-4 mr-2 text-green-500" />WhatsApp
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleShare(selectedImage.url, "facebook")}>
                      <Facebook className="h-4 w-4 mr-2 text-blue-600" />Facebook
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleShare(selectedImage.url, "twitter")}>
                      <Twitter className="h-4 w-4 mr-2 text-sky-500" />Twitter / X
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleShare(selectedImage.url, "instagram")}>
                      <Camera className="h-4 w-4 mr-2 text-pink-500" />Instagram (copy link)
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => handleShare(selectedImage.url)}>
                      <Link2 className="h-4 w-4 mr-2" />Copy Link
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* Navigation */}
              <button className="absolute left-4 top-1/2 -translate-y-1/2 p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors" onClick={() => navigateImage(-1)}>
                <ChevronLeft className="h-8 w-8 text-white" />
              </button>
              <button className="absolute right-4 top-1/2 -translate-y-1/2 p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors" onClick={() => navigateImage(1)}>
                <ChevronRight className="h-8 w-8 text-white" />
              </button>

              {/* Bottom controls */}
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3">
                <button className="p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors" onClick={() => setSlideshowActive(!slideshowActive)}>
                  {slideshowActive ? <Pause className="h-5 w-5 text-white" /> : <Play className="h-5 w-5 text-white" />}
                </button>
              </div>

              <div className="absolute bottom-4 right-4 flex items-center gap-2">
                <button className="p-1.5 bg-white/10 hover:bg-white/20 rounded-full transition-colors" onClick={() => setZoom(z => Math.max(z - 0.25, 0.5))}>
                  <ZoomOut className="h-4 w-4 text-white" />
                </button>
                <span className="text-white text-xs">{Math.round(zoom * 100)}%</span>
                <button className="p-1.5 bg-white/10 hover:bg-white/20 rounded-full transition-colors" onClick={() => setZoom(z => Math.min(z + 0.25, 3))}>
                  <ZoomIn className="h-4 w-4 text-white" />
                </button>
              </div>

              <p className="absolute top-4 left-4 text-white/60 text-sm">{selectedIndex + 1} / {filteredImages.length}</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}