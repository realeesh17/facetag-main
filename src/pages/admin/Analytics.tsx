import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  BarChart3, Users, QrCode, Mail, Image as ImageIcon, 
  TrendingUp, Calendar, ArrowLeft, Eye, Download
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { getSafeErrorMessage } from "@/lib/error-handler";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar,
} from "recharts";

interface AnalyticsData {
  totalPhotos: number;
  totalPersons: number;
  qrScans: number;
  emailsSent: number;
  galleryViews: number;
  photoDownloads: number;
  dailyActivity: { date: string; scans: number; views: number; downloads: number }[];
  eventTypeBreakdown: { name: string; value: number }[];
}

export default function Analytics() {
  const { eventId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [eventName, setEventName] = useState("");
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    if (eventId && user) fetchAnalytics();
  }, [eventId, user]);

  const fetchAnalytics = async () => {
    if (!eventId) return;
    try {
      const { data: event, error: eventError } = await supabase
        .from("events").select("name").eq("id", eventId).single();
      if (eventError) throw eventError;
      setEventName(event.name);

      const { data: persons } = await supabase
        .from("persons").select("id").eq("event_id", eventId);

      const personIds = (persons || []).map(p => p.id);
      let photosCount = 0;
      if (personIds.length > 0) {
        const { count } = await supabase
          .from("person_images").select("id", { count: "exact", head: true })
          .in("person_id", personIds);
        photosCount = count || 0;
      }

      const { data: analyticsEvents } = await supabase
        .from("analytics_events").select("*").eq("event_id", eventId)
        .order("created_at", { ascending: true });

      const events = analyticsEvents || [];
      const qrScans = events.filter(e => e.event_type === "qr_scan").length;
      const emailsSent = events.filter(e => e.event_type === "email_sent").length;
      const galleryViews = events.filter(e => e.event_type === "gallery_view").length;
      const photoDownloads = events.filter(e => e.event_type === "photo_download").length;

      const dailyMap = new Map<string, { scans: number; views: number; downloads: number }>();
      events.forEach(evt => {
        const date = new Date(evt.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
        const existing = dailyMap.get(date) || { scans: 0, views: 0, downloads: 0 };
        if (evt.event_type === "qr_scan") existing.scans++;
        if (evt.event_type === "gallery_view") existing.views++;
        if (evt.event_type === "photo_download") existing.downloads++;
        dailyMap.set(date, existing);
      });

      const dailyActivity = Array.from(dailyMap.entries()).map(([date, data]) => ({ date, ...data }));
      const eventTypeBreakdown = [
        { name: "QR Scans", value: qrScans },
        { name: "Gallery Views", value: galleryViews },
        { name: "Downloads", value: photoDownloads },
        { name: "Emails Sent", value: emailsSent },
      ].filter(item => item.value > 0);

      setAnalytics({
        totalPhotos: photosCount,
        totalPersons: (persons || []).length,
        qrScans, emailsSent, galleryViews, photoDownloads, dailyActivity, eventTypeBreakdown,
      });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error loading analytics", description: getSafeErrorMessage(error) });
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
            <p className="mt-4 text-muted-foreground">Loading analytics...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
          <div className="text-center">
            <p className="text-muted-foreground">No analytics data found</p>
            <Button onClick={() => navigate(`/admin/event/${eventId}`)} className="mt-4">Back to Event</Button>
          </div>
        </div>
      </div>
    );
  }

  const statCards = [
    { title: "Total Photos", value: analytics.totalPhotos, icon: ImageIcon, color: "text-blue-500", bgColor: "bg-blue-500/10" },
    { title: "Persons Identified", value: analytics.totalPersons, icon: Users, color: "text-green-500", bgColor: "bg-green-500/10" },
    { title: "QR Scans", value: analytics.qrScans, icon: QrCode, color: "text-purple-500", bgColor: "bg-purple-500/10" },
    { title: "Emails Sent", value: analytics.emailsSent, icon: Mail, color: "text-orange-500", bgColor: "bg-orange-500/10" },
    { title: "Gallery Views", value: analytics.galleryViews, icon: Eye, color: "text-cyan-500", bgColor: "bg-cyan-500/10" },
    { title: "Photo Downloads", value: analytics.photoDownloads, icon: Download, color: "text-pink-500", bgColor: "bg-pink-500/10" },
  ];

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center gap-4 mb-8">
          <Button variant="ghost" size="icon" onClick={() => navigate(`/admin/event/${eventId}`)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-4xl font-bold text-primary flex items-center gap-3">
              <BarChart3 className="h-10 w-10" />Analytics
            </h1>
            <p className="text-muted-foreground mt-1">{eventName}</p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 mb-8">
          {statCards.map((stat) => (
            <Card key={stat.title} className="card-shadow">
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <div className={`p-3 rounded-xl ${stat.bgColor}`}>
                    <stat.icon className={`h-6 w-6 ${stat.color}`} />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{stat.value.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">{stat.title}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="card-shadow-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><TrendingUp className="h-5 w-5" />Activity Over Time</CardTitle>
              <CardDescription>Daily scans, views, and downloads</CardDescription>
            </CardHeader>
            <CardContent>
              {analytics.dailyActivity.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={analytics.dailyActivity}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="date" className="text-xs" />
                    <YAxis className="text-xs" />
                    <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }} />
                    <Area type="monotone" dataKey="scans" stackId="1" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.6} name="QR Scans" />
                    <Area type="monotone" dataKey="views" stackId="1" stroke="hsl(var(--secondary))" fill="hsl(var(--secondary))" fillOpacity={0.6} name="Gallery Views" />
                    <Area type="monotone" dataKey="downloads" stackId="1" stroke="hsl(var(--accent))" fill="hsl(var(--accent))" fillOpacity={0.6} name="Downloads" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                  <div className="text-center">
                    <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No activity data yet</p>
                    <p className="text-sm">Share QR codes to start tracking</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="card-shadow-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><BarChart3 className="h-5 w-5" />Event Breakdown</CardTitle>
              <CardDescription>Distribution of analytics events</CardDescription>
            </CardHeader>
            <CardContent>
              {analytics.eventTypeBreakdown.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={analytics.eventTypeBreakdown} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis type="number" className="text-xs" />
                    <YAxis dataKey="name" type="category" width={100} className="text-xs" />
                    <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }} />
                    <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                  <div className="text-center">
                    <BarChart3 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No events recorded yet</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
