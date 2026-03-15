import { Card, CardContent } from "@/components/ui/card";
import { User, Shield, Camera, Sparkles, Heart, Download, QrCode, Users, Zap, Share2 } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";

export default function Landing() {
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user && profile) {
      // Redirect based on role
      if (profile.role === "admin") {
        navigate("/admin/events");
      } else {
        navigate("/user/scan");
      }
    }
  }, [user, profile, loading, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-light to-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-light to-background">
      {/* Hero Section */}
      <div className="container mx-auto px-4 py-16">
        <div className="text-center mb-16 animate-fade-in">
          <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-2 rounded-full text-sm font-medium mb-6">
            <Sparkles className="h-4 w-4" />
            AI-Powered Photo Discovery
          </div>
          <h1 className="text-5xl md:text-7xl font-bold text-primary mb-6">
            FaceTag
          </h1>
          <p className="text-xl md:text-2xl text-muted-foreground max-w-3xl mx-auto mb-8">
            Find your event photos instantly. Just scan your QR code and discover every photo you're in – powered by AI face recognition.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link to="/auth?role=user">
              <Button size="lg" className="w-full sm:w-auto text-lg px-8 py-6">
                <QrCode className="mr-2 h-5 w-5" />
                Find My Photos
              </Button>
            </Link>
            <Link to="/auth?role=admin">
              <Button size="lg" variant="outline" className="w-full sm:w-auto text-lg px-8 py-6">
                <Camera className="mr-2 h-5 w-5" />
                I'm an Event Organizer
              </Button>
            </Link>
          </div>
        </div>

        {/* Features Section */}
        <div className="max-w-6xl mx-auto mb-20">
          <h2 className="text-3xl font-bold text-center mb-12">
            Why People Love FaceTag
          </h2>
          <div className="grid md:grid-cols-3 gap-6">
            <Card className="bg-background/50 backdrop-blur border-0 shadow-lg">
              <CardContent className="p-6 text-center">
                <div className="bg-primary/10 rounded-full w-14 h-14 flex items-center justify-center mx-auto mb-4">
                  <Zap className="h-7 w-7 text-primary" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Instant Discovery</h3>
                <p className="text-muted-foreground text-sm">
                  Scan your QR code and find all your photos in seconds, not hours
                </p>
              </CardContent>
            </Card>
            
            <Card className="bg-background/50 backdrop-blur border-0 shadow-lg">
              <CardContent className="p-6 text-center">
                <div className="bg-primary/10 rounded-full w-14 h-14 flex items-center justify-center mx-auto mb-4">
                  <Heart className="h-7 w-7 text-primary" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Save Favorites</h3>
                <p className="text-muted-foreground text-sm">
                  Heart your best moments and create your personal album
                </p>
              </CardContent>
            </Card>
            
            <Card className="bg-background/50 backdrop-blur border-0 shadow-lg">
              <CardContent className="p-6 text-center">
                <div className="bg-primary/10 rounded-full w-14 h-14 flex items-center justify-center mx-auto mb-4">
                  <Share2 className="h-7 w-7 text-primary" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Share Anywhere</h3>
                <p className="text-muted-foreground text-sm">
                  Download HD photos and share directly to social media
                </p>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Role Selection */}
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-semibold text-center mb-4 animate-slide-up">
            Get Started
          </h2>
          <p className="text-center text-muted-foreground mb-12">
            Choose your role to continue
          </p>

          <div className="grid md:grid-cols-2 gap-8">
            {/* User Card */}
            <Link to="/auth?role=user">
              <Card className="hover-lift cursor-pointer card-shadow-lg border-2 hover:border-primary transition-all animate-scale-in h-full">
                <CardContent className="p-8 text-center">
                  <div className="bg-primary-light rounded-full w-24 h-24 flex items-center justify-center mx-auto mb-6">
                    <User className="h-12 w-12 text-primary" />
                  </div>
                  <h3 className="text-2xl font-bold mb-3">Event Attendee</h3>
                  <p className="text-muted-foreground mb-6">
                    Scan your QR code to view, favorite, and download your personal photos from events
                  </p>
                  <div className="space-y-3 text-sm text-left">
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
                        <QrCode className="h-4 w-4 text-primary" />
                      </div>
                      <span>Scan QR codes to find your photos</span>
                    </div>
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
                        <Heart className="h-4 w-4 text-primary" />
                      </div>
                      <span>Save favorites & create albums</span>
                    </div>
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
                        <Download className="h-4 w-4 text-primary" />
                      </div>
                      <span>Download HD & share to social</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>

            {/* Admin Card */}
            <Link to="/auth?role=admin">
              <Card className="hover-lift cursor-pointer card-shadow-lg border-2 hover:border-primary transition-all animate-scale-in h-full" style={{ animationDelay: "0.1s" }}>
                <CardContent className="p-8 text-center">
                  <div className="bg-primary-light rounded-full w-24 h-24 flex items-center justify-center mx-auto mb-6">
                    <Shield className="h-12 w-12 text-primary" />
                  </div>
                  <h3 className="text-2xl font-bold mb-3">Event Organizer</h3>
                  <p className="text-muted-foreground mb-6">
                    Upload event photos, let AI organize faces, and generate QR codes for attendees
                  </p>
                  <div className="space-y-3 text-sm text-left">
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
                        <Camera className="h-4 w-4 text-primary" />
                      </div>
                      <span>Create events & upload photos</span>
                    </div>
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
                        <Users className="h-4 w-4 text-primary" />
                      </div>
                      <span>AI-powered face clustering</span>
                    </div>
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
                        <QrCode className="h-4 w-4 text-primary" />
                      </div>
                      <span>Generate & print QR codes</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-20 text-muted-foreground text-sm">
          <p>Made with ❤️ for event photographers and attendees</p>
        </div>
      </div>
    </div>
  );
}
