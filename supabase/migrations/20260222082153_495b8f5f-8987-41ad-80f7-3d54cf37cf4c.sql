-- Make event-images bucket public so uploaded images can be displayed
UPDATE storage.buckets SET public = true WHERE id = 'event-images';

-- Add public SELECT policy for event-images if not exists
CREATE POLICY "Public read access for event images"
ON storage.objects FOR SELECT
USING (bucket_id = 'event-images');

-- Add upload policy for authenticated users
CREATE POLICY "Authenticated users can upload event images"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'event-images' AND auth.uid() IS NOT NULL);

-- Add delete policy for authenticated users (own uploads)
CREATE POLICY "Authenticated users can delete event images"
ON storage.objects FOR DELETE
USING (bucket_id = 'event-images' AND auth.uid() IS NOT NULL);
