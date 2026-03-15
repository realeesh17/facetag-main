
-- Allow admins to delete their own events
CREATE POLICY "Admins can delete own events"
ON public.events
FOR DELETE
TO authenticated
USING (admin_id = auth.uid());

-- Allow admins to delete persons in their own events
CREATE POLICY "Admins can delete persons in own events"
ON public.persons
FOR DELETE
TO authenticated
USING (EXISTS (
  SELECT 1 FROM events WHERE events.id = persons.event_id AND events.admin_id = auth.uid()
));
