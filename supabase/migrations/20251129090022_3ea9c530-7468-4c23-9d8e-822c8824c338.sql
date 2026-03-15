-- Create user roles enum
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

-- Create profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  display_name TEXT,
  role public.app_role NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Profile policies
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    COALESCE((NEW.raw_user_meta_data->>'role')::public.app_role, 'user')
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Create events table
CREATE TABLE public.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  admin_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'uploading', 'processing', 'ready')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

-- Event policies
CREATE POLICY "Admins can view own events"
  ON public.events FOR SELECT
  USING (admin_id = auth.uid());

CREATE POLICY "Admins can create events"
  ON public.events FOR INSERT
  WITH CHECK (admin_id = auth.uid());

CREATE POLICY "Admins can update own events"
  ON public.events FOR UPDATE
  USING (admin_id = auth.uid());

-- Create persons table
CREATE TABLE public.persons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL,
  name TEXT,
  qr_code TEXT,
  qr_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(event_id, person_id)
);

ALTER TABLE public.persons ENABLE ROW LEVEL SECURITY;

-- Person policies
CREATE POLICY "Anyone can view persons with QR code"
  ON public.persons FOR SELECT
  USING (qr_code IS NOT NULL);

CREATE POLICY "Admins can manage persons in own events"
  ON public.persons FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.events
      WHERE events.id = persons.event_id
      AND events.admin_id = auth.uid()
    )
  );

-- Create person_images table
CREATE TABLE public.person_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID NOT NULL REFERENCES public.persons(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  bbox JSONB,
  face_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.person_images ENABLE ROW LEVEL SECURITY;

-- Image policies
CREATE POLICY "Anyone can view images for persons with QR"
  ON public.person_images FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.persons
      WHERE persons.id = person_images.person_id
      AND persons.qr_code IS NOT NULL
    )
  );

CREATE POLICY "Admins can manage images in own events"
  ON public.person_images FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.persons
      JOIN public.events ON events.id = persons.event_id
      WHERE persons.id = person_images.person_id
      AND events.admin_id = auth.uid()
    )
  );

-- Create storage bucket for event images
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'event-images',
  'event-images',
  true,
  52428800, -- 50MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
);

-- Storage policies for event images
CREATE POLICY "Admins can upload event images"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'event-images' AND
    auth.uid() IS NOT NULL
  );

CREATE POLICY "Anyone can view event images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'event-images');

CREATE POLICY "Admins can delete own event images"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'event-images' AND
    auth.uid() IS NOT NULL
  );

-- Create storage bucket for QR codes
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'qr-codes',
  'qr-codes',
  true,
  1048576, -- 1MB
  ARRAY['image/png']
);

-- Storage policies for QR codes
CREATE POLICY "Anyone can view QR codes"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'qr-codes');

CREATE POLICY "Functions can upload QR codes"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'qr-codes');

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_events_updated_at
  BEFORE UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_persons_updated_at
  BEFORE UPDATE ON public.persons
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();