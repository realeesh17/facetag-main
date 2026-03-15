-- Drop the partial unique index and create a proper unique constraint
DROP INDEX IF EXISTS person_images_face_id_key;
ALTER TABLE public.person_images ADD CONSTRAINT person_images_face_id_unique UNIQUE (face_id);