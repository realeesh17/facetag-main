-- Fix: Personal names and event data publicly accessible
-- The current policy "Anyone can view persons with QR code" exposes names publicly.
-- We need to restrict what fields are accessible or require authentication.

-- Drop the overly permissive policy
DROP POLICY IF EXISTS "Anyone can view persons with QR code" ON public.persons;
DROP POLICY IF EXISTS "Anyone can view images for persons with QR" ON public.person_images;

-- Create a more restrictive policy: require authentication to view persons with QR
-- This ensures only authenticated users can access their photos via QR code
CREATE POLICY "Authenticated users can view persons with QR code"
  ON public.persons
  FOR SELECT
  USING (
    qr_code IS NOT NULL AND 
    auth.uid() IS NOT NULL
  );

-- Same for person_images - require authentication
CREATE POLICY "Authenticated users can view images for persons with QR"
  ON public.person_images
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL AND
    EXISTS (
      SELECT 1 FROM persons
      WHERE persons.id = person_images.person_id 
      AND persons.qr_code IS NOT NULL
    )
  );

-- The profiles table already has secure RLS (users can only view their own profile)
-- Add an additional check to prevent any INSERT bypass
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;

-- Only the trigger should create profiles, not direct user inserts
-- But if needed, ensure users can only create their own profile
CREATE POLICY "Users can insert own profile"
  ON public.profiles
  FOR INSERT
  WITH CHECK (auth.uid() = id);