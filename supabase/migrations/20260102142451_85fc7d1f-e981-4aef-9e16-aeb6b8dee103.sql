-- Add access_token column for secure gallery access
ALTER TABLE public.persons 
ADD COLUMN IF NOT EXISTS access_token TEXT UNIQUE;

-- Create index for fast token lookups
CREATE INDEX IF NOT EXISTS idx_persons_access_token 
ON public.persons(access_token) 
WHERE access_token IS NOT NULL;