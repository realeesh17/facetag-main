// Supabase Storage upload operations
import { supabase } from "@/integrations/supabase/client";

export type UploadProgressCallback = (progress: number) => void;

export const uploadToSupabase = async (
  file: File,
  path: string
): Promise<string> => {
  const { data, error } = await supabase.storage
    .from("event-images")
    .upload(path, file, {
      cacheControl: "3600",
      upsert: false,
    });

  if (error) throw error;

  const { data: urlData } = supabase.storage
    .from("event-images")
    .getPublicUrl(data.path);

  return urlData.publicUrl;
};

export interface BatchUploadResult {
  successful: { file: File; url: string }[];
  failed: { file: File; error: Error }[];
}

export const uploadBatchToSupabase = async (
  files: File[],
  basePath: string,
  onFileProgress?: (fileIndex: number, progress: number) => void,
  onFileComplete?: (fileIndex: number, url: string | null, error?: Error) => void,
  batchSize: number = 5
): Promise<BatchUploadResult> => {
  const result: BatchUploadResult = {
    successful: [],
    failed: [],
  };

  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);

    const batchPromises = batch.map(async (file, batchIndex) => {
      const fileIndex = i + batchIndex;
      const fileExt = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const filePath = `${basePath}/${crypto.randomUUID()}.${fileExt}`;

      onFileProgress?.(fileIndex, 10);

      try {
        const url = await uploadToSupabase(file, filePath);
        onFileProgress?.(fileIndex, 100);
        result.successful.push({ file, url });
        onFileComplete?.(fileIndex, url);
        return { success: true, url };
      } catch (error: any) {
        result.failed.push({ file, error });
        onFileComplete?.(fileIndex, null, error);
        return { success: false, error };
      }
    });

    await Promise.all(batchPromises);
  }

  return result;
};
