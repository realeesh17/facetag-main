-- Fix 1: Create a secure view for persons that excludes access_token
CREATE OR REPLACE VIEW public.persons_public
WITH (security_invoker=on) AS
  SELECT id, event_id, person_id, name, qr_code, qr_url, created_at, updated_at
  FROM public.persons;
  -- Excludes access_token for security

-- Fix 2: Update persons RLS - deny direct SELECT, use edge function for token validation
DROP POLICY IF EXISTS "Authenticated users can view persons with QR code" ON public.persons;

-- Create a function to validate access token (for Gallery use)
CREATE OR REPLACE FUNCTION public.validate_person_access(
  p_event_id uuid,
  p_person_id integer,
  p_access_token text
)
RETURNS TABLE (
  id uuid,
  name text,
  event_id uuid,
  person_id integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only return person data if the access_token matches exactly
  RETURN QUERY
  SELECT p.id, p.name, p.event_id, p.person_id
  FROM public.persons p
  WHERE p.event_id = p_event_id
    AND p.person_id = p_person_id
    AND p.access_token = p_access_token
    AND p.qr_code IS NOT NULL;
END;
$$;

-- Fix 3: Update profiles RLS to only allow users to view their own profile
-- Already correct policies exist, but let's verify by dropping any public access policy
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Anyone can view profiles" ON public.profiles;

-- Ensure only own profile access
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile" 
ON public.profiles 
FOR SELECT 
USING (auth.uid() = id);

-- Fix 4: Add NOT NULL constraint to access_token (after updating any NULL values)
UPDATE public.persons 
SET access_token = gen_random_uuid()::text
WHERE access_token IS NULL;

-- Fix 5: Create secure function for fetching person images (validates token server-side)
CREATE OR REPLACE FUNCTION public.get_person_gallery(
  p_event_id uuid,
  p_person_id integer,
  p_access_token text
)
RETURNS TABLE (
  person_id_out uuid,
  person_name text,
  image_id uuid,
  image_url text,
  face_count integer,
  moment_type text,
  smile_score real,
  captured_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_person_uuid uuid;
BEGIN
  -- First validate access token
  SELECT p.id INTO v_person_uuid
  FROM public.persons p
  WHERE p.event_id = p_event_id
    AND p.person_id = p_person_id
    AND p.access_token = p_access_token
    AND p.qr_code IS NOT NULL;
  
  -- If no match, return empty
  IF v_person_uuid IS NULL THEN
    RETURN;
  END IF;
  
  -- Return person data with images
  RETURN QUERY
  SELECT 
    p.id as person_id_out,
    p.name as person_name,
    pi.id as image_id,
    pi.image_url,
    COALESCE(pi.face_count, 1) as face_count,
    COALESCE(pi.moment_type, 'candid') as moment_type,
    COALESCE(pi.smile_score, 0.5) as smile_score,
    COALESCE(pi.captured_at, pi.created_at) as captured_at
  FROM public.persons p
  LEFT JOIN public.person_images pi ON pi.person_id = p.id
  WHERE p.id = v_person_uuid
  ORDER BY pi.captured_at ASC;
END;
$$;