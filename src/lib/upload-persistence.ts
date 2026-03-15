/**
 * Upload persistence utilities for resumable uploads.
 * Stores pending upload metadata in localStorage so failed uploads
 * can be retried after page refresh or network drops.
 */

const STORAGE_KEY = "pending_uploads";

export interface PendingUpload {
  id: string;
  eventId: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  /** Base64-encoded file data (for small files) or null if too large */
  fileData: string | null;
  /** Storage path where the file should be uploaded */
  storagePath: string;
  /** Upload progress (0-100) */
  progress: number;
  /** Status of the upload */
  status: "pending" | "uploading" | "failed" | "success";
  /** Error message if failed */
  error?: string;
  /** Timestamp when the upload was queued */
  createdAt: number;
  /** Timestamp of last update */
  updatedAt: number;
}

// Maximum file size to store in localStorage (5MB)
const MAX_STORED_FILE_SIZE = 5 * 1024 * 1024;

/**
 * Get all pending uploads from localStorage
 */
export function getPendingUploads(): PendingUpload[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const uploads = JSON.parse(stored) as PendingUpload[];
    // Filter out stale uploads older than 24 hours
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return uploads.filter((u) => u.createdAt > cutoff);
  } catch {
    return [];
  }
}

/**
 * Get pending uploads for a specific event
 */
export function getEventPendingUploads(eventId: string): PendingUpload[] {
  return getPendingUploads().filter((u) => u.eventId === eventId);
}

/**
 * Save pending uploads to localStorage
 */
function savePendingUploads(uploads: PendingUpload[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(uploads));
  } catch (e) {
    console.warn("Failed to save pending uploads:", e);
  }
}

/**
 * Add a new pending upload
 */
export async function addPendingUpload(
  file: File,
  eventId: string,
  storagePath: string
): Promise<PendingUpload> {
  const id = crypto.randomUUID();
  const now = Date.now();

  let fileData: string | null = null;
  if (file.size <= MAX_STORED_FILE_SIZE) {
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      fileData = btoa(binary);
    } catch (e) {
      console.warn("Failed to encode file for persistence:", e);
    }
  }

  const pending: PendingUpload = {
    id,
    eventId,
    fileName: file.name,
    fileSize: file.size,
    fileType: file.type,
    fileData,
    storagePath,
    progress: 0,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };

  const uploads = getPendingUploads();
  uploads.push(pending);
  savePendingUploads(uploads);

  return pending;
}

/**
 * Update a pending upload's status
 */
export function updatePendingUpload(
  id: string,
  updates: Partial<Pick<PendingUpload, "progress" | "status" | "error">>
): void {
  const uploads = getPendingUploads();
  const index = uploads.findIndex((u) => u.id === id);
  if (index !== -1) {
    uploads[index] = {
      ...uploads[index],
      ...updates,
      updatedAt: Date.now(),
    };
    savePendingUploads(uploads);
  }
}

/**
 * Remove a pending upload (e.g., after successful upload or manual clear)
 */
export function removePendingUpload(id: string): void {
  const uploads = getPendingUploads().filter((u) => u.id !== id);
  savePendingUploads(uploads);
}

/**
 * Clear all pending uploads for an event
 */
export function clearEventPendingUploads(eventId: string): void {
  const uploads = getPendingUploads().filter((u) => u.eventId !== eventId);
  savePendingUploads(uploads);
}

/**
 * Clear all failed uploads for an event
 */
export function clearFailedUploads(eventId: string): void {
  const uploads = getPendingUploads().filter(
    (u) => !(u.eventId === eventId && u.status === "failed")
  );
  savePendingUploads(uploads);
}

/**
 * Convert stored base64 data back to a File object
 */
export function restoreFileFromPending(pending: PendingUpload): File | null {
  if (!pending.fileData) {
    console.warn("File data not stored (file was too large):", pending.fileName);
    return null;
  }

  try {
    const binary = atob(pending.fileData);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: pending.fileType });
    return new File([blob], pending.fileName, { type: pending.fileType });
  } catch (e) {
    console.error("Failed to restore file from pending upload:", e);
    return null;
  }
}

/**
 * Get count of failed uploads for an event
 */
export function getFailedUploadCount(eventId: string): number {
  return getEventPendingUploads(eventId).filter((u) => u.status === "failed")
    .length;
}

/**
 * Get all failed uploads that can be retried (have file data)
 */
export function getRetryableUploads(eventId: string): PendingUpload[] {
  return getEventPendingUploads(eventId).filter(
    (u) => u.status === "failed" && u.fileData !== null
  );
}
