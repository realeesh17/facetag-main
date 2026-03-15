import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft } from "lucide-react";

export default function CreateEvent() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [eventName, setEventName] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !eventName.trim()) return;

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("events")
        .insert({ name: eventName.trim(), admin_id: user.id, status: "created" })
        .select()
        .single();
      if (error) throw error;
      toast({ title: "Event created!", description: "You can now upload photos for this event." });
      navigate(`/admin/event/${data.id}`);
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error creating event", description: error.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto px-4 py-6 sm:py-8">
        <div className="max-w-2xl mx-auto">
          <Button variant="ghost" size="sm" onClick={() => navigate("/admin/events")} className="mb-4 -ml-2">
            <ArrowLeft className="mr-1 h-4 w-4" />Back to Events
          </Button>
          <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-1">Create Event</h1>
          <p className="text-muted-foreground text-sm mb-8">
            Create a new event to start uploading and organizing photos
          </p>

          <Card className="card-shadow-lg">
            <CardHeader>
              <CardTitle>Event Details</CardTitle>
              <CardDescription>Enter the name of your event</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreateEvent} className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="eventName">Event Name</Label>
                  <Input
                    id="eventName"
                    placeholder="e.g., Wedding 2024, Company Party"
                    value={eventName}
                    onChange={(e) => setEventName(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                <div className="flex flex-col-reverse sm:flex-row gap-3">
                  <Button type="button" variant="outline" onClick={() => navigate("/admin/events")} disabled={loading}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={loading || !eventName.trim()} className="flex-1">
                    {loading ? "Creating..." : "Create Event"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
