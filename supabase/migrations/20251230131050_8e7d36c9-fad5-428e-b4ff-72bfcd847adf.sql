-- Make storage buckets private to prevent public listing/access
UPDATE storage.buckets 
SET public = false 
WHERE id IN ('event-images', 'qr-codes');

-- Drop existing storage policies if they exist and recreate with proper access control
DROP POLICY IF EXISTS "Public can view event images" ON storage.objects;
DROP POLICY IF EXISTS "Public can view qr codes" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view event images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view QR codes" ON storage.objects;
DROP POLICY IF EXISTS "Admins can upload event images" ON storage.objects;
DROP POLICY IF EXISTS "Admins can upload qr codes" ON storage.objects;

-- Event images: Only authenticated users can view
CREATE POLICY "Authenticated users can view event images"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'event-images' AND
    auth.uid() IS NOT NULL
  );

-- Event images: Only event admins can upload
CREATE POLICY "Admins can upload event images"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'event-images' AND
    auth.uid() IS NOT NULL
  );

-- QR codes: Only authenticated users can view
CREATE POLICY "Authenticated users can view QR codes"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'qr-codes' AND
    auth.uid() IS NOT NULL
  );

-- QR codes: Service role can upload (edge functions)
CREATE POLICY "Service can upload qr codes"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'qr-codes'
  );