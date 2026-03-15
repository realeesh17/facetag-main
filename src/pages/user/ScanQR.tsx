import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QrCode, Camera, Upload, X, SwitchCamera, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import jsQR from "jsqr";

export default function ScanQR() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [manualCode, setManualCode] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("environment");
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number>(0);
  const { toast } = useToast();

  useEffect(() => {
    return () => stopCamera();
  }, []);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facingMode }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        setCameraActive(true);
        videoRef.current.onloadedmetadata = () => scanQRCode();
      }
    } catch (error: any) {
      toast({ variant: "destructive", title: "Camera access denied", description: "Please allow camera access to scan QR codes" });
    }
  };

  const stopCamera = () => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
  };

  const switchCamera = async () => {
    stopCamera();
    setFacingMode(prev => prev === "user" ? "environment" : "user");
    setTimeout(() => startCamera(), 100);
  };

  const scanQRCode = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !cameraActive) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const scan = () => {
      if (!video || video.readyState !== video.HAVE_ENOUGH_DATA) {
        animationRef.current = requestAnimationFrame(scan);
        return;
      }
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "dontInvert" });
      if (code) { handleQRCode(code.data); return; }
      animationRef.current = requestAnimationFrame(scan);
    };
    animationRef.current = requestAnimationFrame(scan);
  }, [cameraActive]);

  useEffect(() => {
    if (cameraActive) scanQRCode();
  }, [cameraActive, scanQRCode]);

  const handleQRCode = (data: string) => {
    stopCamera();
    setScanning(true);
    let eventId: string | null = null;
    let personIdValue: string | null = null;
    let accessToken: string | null = null;

    try {
      const url = new URL(data);
      const pathParts = url.pathname.split('/').filter(Boolean);
      const galleryIndex = pathParts.indexOf('gallery');
      if (galleryIndex !== -1 && pathParts.length > galleryIndex + 1) {
        toast({ title: "QR Code scanned!", description: "Opening your photos..." });
        navigate(`/gallery/${pathParts[galleryIndex + 1]}`);
        return;
      }
      const eventIndex = pathParts.indexOf('event');
      if (eventIndex !== -1 && pathParts.length > eventIndex + 3) {
        eventId = pathParts[eventIndex + 1];
        personIdValue = pathParts[eventIndex + 2];
        accessToken = pathParts[eventIndex + 3];
      }
    } catch {
      const parts = data.split('_');
      if (parts.length === 3) { eventId = parts[0]; personIdValue = parts[1]; accessToken = parts[2]; }
      else if (parts.length === 2) { eventId = parts[0]; personIdValue = parts[1]; }
    }

    if (eventId && personIdValue && accessToken) {
      toast({ title: "QR Code scanned!", description: "Opening your photos..." });
      navigate(`/event/${eventId}/${personIdValue}/${accessToken}`);
    } else if (eventId && personIdValue) {
      navigate(`/gallery/${data}`);
    } else {
      toast({ variant: "destructive", title: "Invalid QR Code", description: "This QR code is not a valid FaceTag code" });
      setScanning(false);
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualCode.trim()) handleQRCode(manualCode.trim());
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width; canvas.height = img.height;
      ctx?.drawImage(img, 0, 0);
      const imageData = ctx?.getImageData(0, 0, canvas.width, canvas.height);
      if (!imageData) return;
      const code = jsQR(imageData.data, imageData.width, imageData.height);
      if (code) handleQRCode(code.data);
      else toast({ variant: "destructive", title: "No QR code found", description: "Could not detect a QR code in this image" });
    };
    img.src = URL.createObjectURL(file);
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto px-4 py-6 sm:py-8">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-1">Find My Photos</h1>
          <p className="text-muted-foreground text-sm mb-8">Scan or enter your QR code to view your personal photos</p>
          
          <div className="space-y-4 sm:space-y-6">
            {/* Camera scan */}
            <Card className="card-shadow-lg overflow-hidden">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center text-lg"><Camera className="mr-2 h-5 w-5" />Camera Scan</CardTitle>
                <CardDescription>Point your camera at the QR code</CardDescription>
              </CardHeader>
              <CardContent>
                {cameraActive ? (
                  <div className="relative rounded-lg overflow-hidden">
                    <video ref={videoRef} className="w-full" playsInline muted />
                    <canvas ref={canvasRef} className="hidden" />
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="w-48 h-48 border-4 border-primary/80 rounded-2xl">
                        <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-primary rounded-tl-xl" />
                        <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-primary rounded-tr-xl" />
                        <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-primary rounded-bl-xl" />
                        <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-primary rounded-br-xl" />
                      </div>
                    </div>
                    <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-3">
                      <Button size="icon" variant="secondary" onClick={switchCamera} className="rounded-full h-10 w-10">
                        <SwitchCamera className="h-5 w-5" />
                      </Button>
                      <Button size="icon" variant="destructive" onClick={stopCamera} className="rounded-full h-10 w-10">
                        <X className="h-5 w-5" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="border-2 border-dashed border-border rounded-lg p-8 sm:p-12 text-center cursor-pointer hover:border-primary transition-colors" onClick={startCamera}>
                    <Camera className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <p className="text-muted-foreground mb-4 text-sm">Tap to start camera</p>
                    <Button><Camera className="mr-2 h-4 w-4" />Open Camera</Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Upload QR image */}
            <Card className="card-shadow">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center text-lg"><Upload className="mr-2 h-5 w-5" />Upload QR Image</CardTitle>
                <CardDescription>Upload a photo of your QR code</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-primary transition-colors">
                  <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
                  <Label htmlFor="qr-upload" className="cursor-pointer">
                    <span className="text-primary font-medium">Click to upload</span>
                    <span className="text-muted-foreground text-sm"> QR code image</span>
                  </Label>
                  <Input id="qr-upload" type="file" accept="image/*" className="sr-only" onChange={handleFileUpload} />
                </div>
              </CardContent>
            </Card>

            {/* Manual entry */}
            <Card className="card-shadow">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center text-lg"><QrCode className="mr-2 h-5 w-5" />Enter Code</CardTitle>
                <CardDescription>Type the code from your QR card</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleManualSubmit} className="flex gap-2">
                  <Input placeholder="Paste or type your code" value={manualCode} onChange={(e) => setManualCode(e.target.value)} required className="flex-1" />
                  <Button type="submit" disabled={!manualCode.trim()}>Go</Button>
                </form>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
