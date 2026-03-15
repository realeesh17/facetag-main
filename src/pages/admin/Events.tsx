import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Calendar, Users, Image as ImageIcon, Trash2, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface Event {
  id: string;
  name: string;
  status: string;
  created_at: string;
  admin_id: string;
}

export default function AdminEvents() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    if (user) fetchEvents();
  }, [user]);

  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchEvents = async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from("events")
        .select("*")
        .eq("admin_id", user.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      setEvents(data || []);
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error loading events", description: error.message });
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteEvent = async (eventId: string, eventName: string) => {
    setDeleting(eventId);
    try {
      // Delete person_images, persons, analytics_events first (cascade should handle persons via FK, but be explicit)
      const { data: eventPersons } = await supabase.from("persons").select("id").eq("event_id", eventId);
      if (eventPersons && eventPersons.length > 0) {
        const personIds = eventPersons.map(p => p.id);
        await supabase.from("person_images").delete().in("person_id", personIds);
        await supabase.from("favorites").delete().in("person_id", personIds);
        await supabase.from("persons").delete().eq("event_id", eventId);
      }
      await supabase.from("analytics_events").delete().eq("event_id", eventId);
      const { error } = await supabase.from("events").delete().eq("id", eventId);
      if (error) throw error;
      setEvents(prev => prev.filter(e => e.id !== eventId));
      toast({ title: "Event deleted", description: `"${eventName}" has been permanently deleted.` });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Delete failed", description: error.message });
    } finally {
      setDeleting(null);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "ready": return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
      case "processing": case "uploading": return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400";
      default: return "bg-muted text-muted-foreground";
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary mx-auto"></div>
            <p className="mt-4 text-muted-foreground text-sm">Loading events...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto px-4 py-6 sm:py-8">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
          <div>
            <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-1">My Events</h1>
            <p className="text-muted-foreground text-sm">Manage your event photos and attendees</p>
          </div>
          <Button onClick={() => navigate("/admin/create-event")} size="default">
            <Plus className="mr-2 h-4 w-4" />
            Create Event
          </Button>
        </div>

        {events.length === 0 ? (
          <Card className="text-center py-12 card-shadow">
            <CardContent>
              <div className="bg-primary/10 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
                <Calendar className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-2">No events yet</h3>
              <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
                Create your first event to start uploading photos and organizing them with AI
              </p>
              <Button onClick={() => navigate("/admin/create-event")}>
                <Plus className="mr-2 h-4 w-4" />Create Your First Event
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {events.map((event) => (
              <Card
                key={event.id}
                className="hover-lift cursor-pointer card-shadow group relative"
                onClick={() => navigate(`/admin/event/${event.id}`)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-lg leading-snug group-hover:text-primary transition-colors">
                      {event.name}
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-1 rounded-full font-medium whitespace-nowrap ${getStatusColor(event.status)}`}>
                        {event.status}
                      </span>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete "{event.name}"?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently delete this event, all uploaded photos, persons, and QR codes. This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              onClick={(e) => { e.stopPropagation(); handleDeleteEvent(event.id, event.name); }}
                              disabled={deleting === event.id}
                            >
                              {deleting === event.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                  <CardDescription className="text-xs">
                    Created {new Date(event.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex items-center text-sm text-muted-foreground">
                    <Users className="h-4 w-4 mr-2" />
                    <span>Click to manage</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
