-- Add enhanced metadata to person_images for smart filtering
ALTER TABLE public.person_images 
ADD COLUMN IF NOT EXISTS face_count INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS moment_type TEXT DEFAULT 'candid',
ADD COLUMN IF NOT EXISTS smile_score REAL DEFAULT 0.5,
ADD COLUMN IF NOT EXISTS captured_at TIMESTAMP WITH TIME ZONE DEFAULT now();

-- Create favorites table for users to save their favorite photos
CREATE TABLE IF NOT EXISTS public.favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  person_id UUID NOT NULL REFERENCES public.persons(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(user_id, image_url)
);

-- Enable RLS on favorites
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;

-- Users can view their own favorites
CREATE POLICY "Users can view own favorites"
  ON public.favorites FOR SELECT
  USING (auth.uid() = user_id);

-- Users can create their own favorites  
CREATE POLICY "Users can create own favorites"
  ON public.favorites FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own favorites
CREATE POLICY "Users can delete own favorites"
  ON public.favorites FOR DELETE
  USING (auth.uid() = user_id);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_favorites_user_id ON public.favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_person_images_moment ON public.person_images(moment_type);
CREATE INDEX IF NOT EXISTS idx_person_images_face_count ON public.person_images(face_count);