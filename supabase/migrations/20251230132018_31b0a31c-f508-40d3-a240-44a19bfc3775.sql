-- Fix: Prevent privilege escalation via user metadata in handle_new_user()
-- Users should NOT be able to set their own role during signup

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Always set role to 'user' for new signups
  -- Admins must be promoted through a separate admin process, not via signup metadata
  INSERT INTO public.profiles (id, email, display_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    'user'  -- Always default to 'user', never trust metadata for role
  )
  ON CONFLICT (id) DO NOTHING;
  
  RETURN NEW;
END;
$$;