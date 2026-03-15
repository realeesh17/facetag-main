/**
 * Client-side image preprocessing: resize, compress, and HEIC→JPEG conversion.
 * Reduces upload failures and speeds up mobile uploads.
 */

// Maximum dimension (width or height) for uploaded images
const MAX_DIMENSION = 4096;
// JPEG quality (0-1) — high quality to preserve detail for face recognition
const JPEG_QUALITY = 0.92;
// Maximum file size in bytes before we attempt compression (10MB)
const COMPRESS_THRESHOLD = 10 * 1024 * 1024;

export interface PreprocessResult {
  file: File;
  originalName: string;
  wasProcessed: boolean;
  originalSize: number;
  newSize: number;
}

/**
 * Check if a file is HEIC/HEIF format
 */
const isHeicFile = (file: File): boolean => {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  return (
    type === "image/heic" ||
    type === "image/heif" ||
    name.endsWith(".heic") ||
    name.endsWith(".heif")
  );
};

/**
 * Convert HEIC to JPEG using heic2any
 */
const convertHeicToJpeg = async (file: File): Promise<Blob> => {
  const heic2any = (await import("heic2any")).default;
  const result = await heic2any({
    blob: file,
    toType: "image/jpeg",
    quality: JPEG_QUALITY,
  });
  // heic2any can return an array for multi-image HEIC files
  return Array.isArray(result) ? result[0] : result;
};

/**
 * Load an image from a Blob/File
 */
const loadImage = (blob: Blob): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      reject(new Error("Failed to load image"));
    };
    img.src = URL.createObjectURL(blob);
  });
};

/**
 * Resize and compress an image using canvas
 */
const resizeAndCompress = async (
  blob: Blob,
  maxDimension: number,
  quality: number
): Promise<Blob> => {
  const img = await loadImage(blob);

  let { width, height } = img;
  const needsResize = width > maxDimension || height > maxDimension;

  if (needsResize) {
    if (width > height) {
      height = Math.round((height * maxDimension) / width);
      width = maxDimension;
    } else {
      width = Math.round((width * maxDimension) / height);
      height = maxDimension;
    }
  }

  // Use OffscreenCanvas if available for better performance
  let canvas: HTMLCanvasElement | OffscreenCanvas;
  let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;

  if (typeof OffscreenCanvas !== "undefined") {
    canvas = new OffscreenCanvas(width, height);
    ctx = canvas.getContext("2d");
  } else {
    canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    ctx = canvas.getContext("2d");
  }

  if (!ctx) {
    throw new Error("Failed to get canvas context");
  }

  // Draw with high-quality scaling
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, width, height);

  // Convert to blob
  if (canvas instanceof OffscreenCanvas) {
    return await canvas.convertToBlob({ type: "image/jpeg", quality });
  } else {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Canvas toBlob failed"))),
        "image/jpeg",
        quality
      );
    });
  }
};

/**
 * Preprocess a single image file:
 * 1. Convert HEIC to JPEG if needed
 * 2. Resize if larger than MAX_DIMENSION
 * 3. Compress if file is large
 */
export const preprocessImage = async (file: File): Promise<PreprocessResult> => {
  const originalSize = file.size;
  const originalName = file.name;
  let blob: Blob = file;
  let wasProcessed = false;
  let outputName = originalName;

  try {
    // Step 1: Convert HEIC to JPEG
    if (isHeicFile(file)) {
      console.log(`Converting HEIC: ${file.name}`);
      blob = await convertHeicToJpeg(file);
      outputName = originalName.replace(/\.heic$/i, ".jpg").replace(/\.heif$/i, ".jpg");
      wasProcessed = true;
    }

    // Step 2: Only resize/compress if truly necessary (HEIC conversion, oversized, or huge file)
    // Do NOT re-encode images that are already fine — preserve original quality
    const img = await loadImage(blob);
    const needsResize = img.width > MAX_DIMENSION || img.height > MAX_DIMENSION;
    const needsCompress = blob.size > COMPRESS_THRESHOLD;

    if (needsResize || needsCompress || wasProcessed) {
      console.log(
        `Processing image: ${file.name} (${Math.round(blob.size / 1024)}KB, ${img.width}x${img.height})`
      );
      blob = await resizeAndCompress(blob, MAX_DIMENSION, JPEG_QUALITY);
      wasProcessed = true;

      // Update extension if we converted to JPEG
      if (!outputName.toLowerCase().endsWith(".jpg") && !outputName.toLowerCase().endsWith(".jpeg")) {
        outputName = outputName.replace(/\.[^.]+$/, ".jpg");
      }
    }

    // Create new File object
    const processedFile = new File([blob], outputName, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });

    console.log(
      `Preprocessed: ${originalName} (${Math.round(originalSize / 1024)}KB → ${Math.round(processedFile.size / 1024)}KB)`
    );

    return {
      file: processedFile,
      originalName,
      wasProcessed,
      originalSize,
      newSize: processedFile.size,
    };
  } catch (error) {
    console.error(`Failed to preprocess ${file.name}:`, error);
    // Return original file if preprocessing fails
    return {
      file,
      originalName,
      wasProcessed: false,
      originalSize,
      newSize: file.size,
    };
  }
};

/**
 * Preprocess multiple images with progress callback
 */
export const preprocessImages = async (
  files: File[],
  onProgress?: (processed: number, total: number) => void
): Promise<PreprocessResult[]> => {
  const results: PreprocessResult[] = [];

  for (let i = 0; i < files.length; i++) {
    const result = await preprocessImage(files[i]);
    results.push(result);
    onProgress?.(i + 1, files.length);
  }

  return results;
};

/**
 * Get a summary of preprocessing results
 */
export const getPreprocessingSummary = (results: PreprocessResult[]) => {
  const totalOriginal = results.reduce((sum, r) => sum + r.originalSize, 0);
  const totalNew = results.reduce((sum, r) => sum + r.newSize, 0);
  const processedCount = results.filter((r) => r.wasProcessed).length;
  const savedBytes = totalOriginal - totalNew;
  const savedPercent = totalOriginal > 0 ? Math.round((savedBytes / totalOriginal) * 100) : 0;

  return {
    totalFiles: results.length,
    processedCount,
    totalOriginal,
    totalNew,
    savedBytes,
    savedPercent,
  };
};
