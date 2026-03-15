// Safe error message handler - prevents information leakage
export function getSafeErrorMessage(error: any): string {
  // Log detailed error for debugging (only visible to developers)
  console.error('Application error:', error);
  
  const msg = (error?.message || '').toLowerCase();
  const code = error?.code || '';
  
  // Firebase Storage specific errors
  if (code.startsWith('storage/')) {
    return getFirebaseStorageErrorMessage(code, msg);
  }
  
  // Map common errors to safe user-friendly messages
  if (msg.includes('policy') || msg.includes('rls')) {
    return 'Access denied. You may not have permission for this resource.';
  }
  
  if (msg.includes('not found') || msg.includes('no rows')) {
    return 'The requested item was not found.';
  }
  
  if (msg.includes('unique') || msg.includes('duplicate')) {
    return 'This item already exists.';
  }
  
  if (msg.includes('invalid login') || msg.includes('credentials') || msg.includes('invalid email or password')) {
    return 'Invalid email or password.';
  }
  
  if (msg.includes('user') && msg.includes('already')) {
    return 'An account with this email already exists.';
  }
  
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('failed to fetch')) {
    return 'Network error. Please check your connection.';
  }
  
  if (msg.includes('rate limit') || msg.includes('too many')) {
    return 'Too many requests. Please try again later.';
  }
  
  if (msg.includes('unauthorized') || msg.includes('jwt')) {
    return 'Session expired. Please sign in again.';
  }
  
  if (msg.includes('email') && msg.includes('format')) {
    return 'Please enter a valid email address.';
  }
  
  if (msg.includes('password') && (msg.includes('short') || msg.includes('weak'))) {
    return 'Password must be at least 6 characters.';
  }

  return 'An unexpected error occurred. Please try again.';
}

// Firebase Storage specific error messages
function getFirebaseStorageErrorMessage(code: string, message: string): string {
  const errorMessages: Record<string, string> = {
    'storage/unauthorized': 'Upload access denied. Please ensure Firebase Storage rules are configured correctly.',
    'storage/canceled': 'Upload was canceled.',
    'storage/unknown': 'An unknown storage error occurred. Please try again.',
    'storage/object-not-found': 'The requested file was not found.',
    'storage/bucket-not-found': 'Storage is not configured. Please check Firebase setup.',
    'storage/project-not-found': 'Firebase project not found. Please check configuration.',
    'storage/quota-exceeded': 'Storage quota exceeded. Please contact support.',
    'storage/unauthenticated': 'Authentication required for this operation.',
    'storage/retry-limit-exceeded': 'Upload failed after multiple attempts. Please check your connection and try again.',
    'storage/invalid-checksum': 'File was corrupted during upload. Please try again.',
    'storage/server-file-wrong-size': 'Upload size mismatch. Please try again.',
    'storage/invalid-url': 'Invalid storage URL.',
    'storage/invalid-argument': 'Invalid upload parameters.',
    'storage/no-default-bucket': 'No default storage bucket configured.',
  };
  
  return errorMessages[code] || `Storage error: ${message}`;
}

// UUID validation helper
export function isValidUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

// File validation constants
export const ALLOWED_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif'] as const;
export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export function validateImageFile(file: File): { valid: boolean; error?: string } {
  // Validate size
  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: `${file.name} exceeds 50MB limit` };
  }

  // Validate MIME type
  if (!file.type.startsWith('image/')) {
    return { valid: false, error: `${file.name} is not an image` };
  }

  // Validate extension
  const fileExt = file.name.split('.').pop()?.toLowerCase();
  if (!fileExt || !ALLOWED_IMAGE_EXTENSIONS.includes(fileExt as any)) {
    return { 
      valid: false, 
      error: `${file.name} has invalid extension. Allowed: ${ALLOWED_IMAGE_EXTENSIONS.join(', ')}` 
    };
  }

  return { valid: true };
}

// Format file size for display
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
