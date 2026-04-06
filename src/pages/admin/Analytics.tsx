import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import {
  BarChart3, Users, QrCode, Mail, Image as ImageIcon,
  TrendingUp, Calendar, ArrowLeft, Eye, Download, Activity, Zap,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { getSafeErrorMessage } from "@/lib/error-handler";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Cell,
} from "recharts";

interface AnalyticsData {
  totalPhotos: number;
  totalPersons: number;
  qrScans: number;
  emailsSent: number;
  galleryViews: number;
  photoDownloads: number;
  dailyActivity: { date: string; scans: number; views: number; downloads: number }[];
  eventTypeBreakdown: { name: string; value: number; color: string }[];
}

function StatCard({ title, value, icon: Icon, color, bg, trend }: any) {
  return (
    <div className={`relative overflow-hidden rounded-2xl border border-border bg-card p-5 hover:shadow-lg transition-all group`}>
      <div className="flex items-start justify-between mb-4">
        <div className={`w-10 h-10 ${bg} rounded-xl flex items-center justify-center`}>
          <Icon className={`h-5 w-5 ${color}`} />
        </div>
        {trend !== undefined && (
          <span className="text-xs text-green-500 font-medium bg-green-500/10 px-2 py-0.5 rounded-full">
            +{trend}%
          </span>
        )}
      </div>
      <div className="text-3xl font-black text-foreground mb-1">{value.toLocaleString()}</div>
      <div className="text-xs text-muted-foreground font-medium">{title}</div>
      {/* Decorative bar */}
      <div className={`absolute bottom-0 left-0 right-0 h-0.5 ${bg} opacity-50 group-hover:opacity-100 transition-opacity`} />
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-background border border-border rounded-xl p-3 shadow-xl text-xs">
      <p className="font-semibold text-foreground mb-2">{label}</p>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-medium text-foreground">{p.value}</span>
        </div>
      ))}
    </div>
  );
};

export default function Analytics() {
  const { eventId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [eventName, setEventName] = useState("");
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "activity">("overview");
  const { toast } = useToast();

  useEffect(() => { if (eventId && user) fetchAnalytics(); }, [eventId, user]);

  const fetchAnalytics = async () => {
    if (!eventId) return;
    try {
      const { data: event } = await supabase.from("events").select("name").eq("id", eventId).single();
      setEventName(event?.name || "");

      const { data: persons } = await supabase.from("persons").select("id").eq("event_id", eventId);
      const personIds = (persons || []).map(p => p.id);
      let photosCount = 0;
      if (personIds.length > 0) {
        const { count } = await supabase.from("person_images")
          .select("id", { count: "exact", head: true }).in("person_id", personIds);
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
        const ex = dailyMap.get(date) || { scans: 0, views: 0, downloads: 0 };
        if (evt.event_type === "qr_scan") ex.scans++;
        if (evt.event_type === "gallery_view") ex.views++;
        if (evt.event_type === "photo_download") ex.downloads++;
        dailyMap.set(date, ex);
      });

      setAnalytics({
        totalPhotos: photosCount,
        totalPersons: personIds.length,
        qrScans, emailsSent, galleryViews, photoDownloads,
        dailyActivity: Array.from(dailyMap.entries()).map(([date, d]) => ({ date, ...d })),
        eventTypeBreakdown: [
          { name: "QR Scans", value: qrScans, color: "#3b82f6" },
          { name: "Gallery Views", value: galleryViews, color: "#8b5cf6" },
          { name: "Downloads", value: photoDownloads, color: "#10b981" },
          { name: "Emails", value: emailsSent, color: "#f59e0b" },
        ].filter(i => i.value > 0),
      });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: getSafeErrorMessage(error) });
    } finally { setLoading(false); }
  };

  if (loading) return (
    <div className="min-h-screen bg-background"><Navbar />
      <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
        <div className="relative w-12 h-12">
          <div className="absolute inset-0 rounded-full border-2 border-primary/20 animate-ping" />
          <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary animate-spin" />
        </div>
      </div>
    </div>
  );

  if (!analytics) return (
    <div className="min-h-screen bg-background"><Navbar />
      <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">No analytics data found</p>
          <Button onClick={() => navigate(`/admin/event/${eventId}`)}>Back to Event</Button>
        </div>
      </div>
    </div>
  );

  const totalEngagement = analytics.qrScans + analytics.galleryViews + analytics.photoDownloads;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto px-4 py-8 max-w-6xl">

        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Button variant="ghost" size="icon" onClick={() => navigate(`/admin/event/${eventId}`)} className="rounded-xl">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center">
                <BarChart3 className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-black text-foreground">Analytics</h1>
                <p className="text-sm text-muted-foreground">{eventName}</p>
              </div>
            </div>
          </div>
          {/* Tab switcher */}
          <div className="flex gap-1 bg-muted rounded-xl p-1">
            {(["overview", "activity"] as const).map(t => (
              <button key={t} onClick={() => setActiveTab(t)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium capitalize transition-all ${activeTab === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Engagement summary banner */}
        <div className="mb-6 p-5 rounded-2xl bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border border-primary/15 flex items-center gap-6">
          <div className="w-12 h-12 bg-primary/15 rounded-2xl flex items-center justify-center shrink-0">
            <Activity className="h-6 w-6 text-primary" />
          </div>
          <div className="flex-1">
            <div className="text-2xl font-black text-foreground">{totalEngagement} <span className="text-base font-normal text-muted-foreground">total interactions</span></div>
            <div className="text-sm text-muted-foreground mt-0.5">Across {analytics.totalPersons} identified persons in this event</div>
          </div>
          <div className="hidden md:flex items-center gap-6 text-center">
            {[
              { l: "Engagement rate", v: analytics.totalPersons > 0 ? `${Math.round((analytics.qrScans / Math.max(analytics.totalPersons, 1)) * 100)}%` : "0%" },
              { l: "Avg downloads/person", v: analytics.totalPersons > 0 ? (analytics.photoDownloads / Math.max(analytics.totalPersons, 1)).toFixed(1) : "0" },
            ].map(s => (
              <div key={s.l}>
                <div className="text-xl font-black text-foreground">{s.v}</div>
                <div className="text-xs text-muted-foreground">{s.l}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Stat cards grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
          {[
            { title: "Total Photos", value: analytics.totalPhotos, icon: ImageIcon, color: "text-blue-500", bg: "bg-blue-500/10" },
            { title: "Persons Found", value: analytics.totalPersons, icon: Users, color: "text-emerald-500", bg: "bg-emerald-500/10" },
            { title: "QR Scans", value: analytics.qrScans, icon: QrCode, color: "text-violet-500", bg: "bg-violet-500/10" },
            { title: "Gallery Views", value: analytics.galleryViews, icon: Eye, color: "text-cyan-500", bg: "bg-cyan-500/10" },
            { title: "Downloads", value: analytics.photoDownloads, icon: Download, color: "text-pink-500", bg: "bg-pink-500/10" },
            { title: "Emails Sent", value: analytics.emailsSent, icon: Mail, color: "text-amber-500", bg: "bg-amber-500/10" },
          ].map(s => <StatCard key={s.title} {...s} />)}
        </div>

        {/* Charts */}
        <div className="grid lg:grid-cols-5 gap-6">
          {/* Area chart — takes 3 cols */}
          <div className="lg:col-span-3 rounded-2xl border border-border bg-card p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="font-bold text-foreground flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" />Activity Over Time
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">Daily scans, views and downloads</p>
              </div>
            </div>
            {analytics.dailyActivity.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={analytics.dailyActivity}>
                  <defs>
                    <linearGradient id="scans" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="views" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="downloads" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="scans" stroke="#3b82f6" strokeWidth={2} fill="url(#scans)" name="QR Scans" />
                  <Area type="monotone" dataKey="views" stroke="#8b5cf6" strokeWidth={2} fill="url(#views)" name="Gallery Views" />
                  <Area type="monotone" dataKey="downloads" stroke="#10b981" strokeWidth={2} fill="url(#downloads)" name="Downloads" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[260px] flex flex-col items-center justify-center text-muted-foreground gap-3">
                <Calendar className="h-12 w-12 opacity-30" />
                <div className="text-center">
                  <p className="font-medium">No activity yet</p>
                  <p className="text-sm opacity-70">Share QR codes to start tracking</p>
                </div>
              </div>
            )}
          </div>

          {/* Bar chart + breakdown — takes 2 cols */}
          <div className="lg:col-span-2 space-y-4">
            {/* Breakdown chart */}
            <div className="rounded-2xl border border-border bg-card p-6">
              <h3 className="font-bold text-foreground flex items-center gap-2 mb-5">
                <Zap className="h-4 w-4 text-primary" />Event Breakdown
              </h3>
              {analytics.eventTypeBreakdown.length > 0 ? (
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={analytics.eventTypeBreakdown} layout="vertical" barSize={14}>
                    <XAxis type="number" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={80} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="value" radius={[0, 6, 6, 0]} name="Count">
                      {analytics.eventTypeBreakdown.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[160px] flex items-center justify-center text-muted-foreground text-sm">No events yet</div>
              )}
            </div>

            {/* Quick stats list */}
            <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
              <h3 className="font-bold text-foreground text-sm mb-4">Quick Stats</h3>
              {[
                { label: "Photos per person", value: analytics.totalPersons > 0 ? (analytics.totalPhotos / analytics.totalPersons).toFixed(1) : "—", color: "bg-blue-500" },
                { label: "Scan rate", value: analytics.totalPersons > 0 ? `${Math.round((analytics.qrScans / analytics.totalPersons) * 100)}%` : "0%", color: "bg-violet-500" },
                { label: "Download rate", value: analytics.qrScans > 0 ? `${Math.round((analytics.photoDownloads / analytics.qrScans) * 100)}%` : "0%", color: "bg-emerald-500" },
              ].map(s => (
                <div key={s.label} className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${s.color} shrink-0`} />
                  <span className="text-sm text-muted-foreground flex-1">{s.label}</span>
                  <span className="text-sm font-bold text-foreground">{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}