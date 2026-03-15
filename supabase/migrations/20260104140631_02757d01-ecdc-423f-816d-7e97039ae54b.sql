-- Create analytics events table
CREATE TABLE public.analytics_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  person_id UUID REFERENCES public.persons(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('qr_scan', 'email_sent', 'photo_download', 'gallery_view')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

-- Admins can view analytics for their events
CREATE POLICY "Admins can view analytics for own events"
ON public.analytics_events
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM events 
    WHERE events.id = analytics_events.event_id 
    AND events.admin_id = auth.uid()
  )
);

-- Allow insert for tracking (public for edge functions)
CREATE POLICY "Allow insert analytics"
ON public.analytics_events
FOR INSERT
WITH CHECK (true);

-- Create index for faster queries
CREATE INDEX idx_analytics_event_id ON public.analytics_events(event_id);
CREATE INDEX idx_analytics_event_type ON public.analytics_events(event_type);
CREATE INDEX idx_analytics_created_at ON public.analytics_events(created_at);