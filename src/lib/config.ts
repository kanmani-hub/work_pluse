/**
 * Supabase client configuration and startup validation.
 * Supports development, testing, staging, and production modes.
 */

export const BLOCKED_STAGING_PROJECT_REF = 'jiicnqgafzvkgfcienpm';

/**
 * Extracts the Supabase project reference subdomain from a standard Supabase URL.
 * e.g. "https://jiicnqgafzvkgfcienpm.supabase.co" -> "jiicnqgafzvkgfcienpm"
 */
export function extractProjectRef(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = url.trim().match(/^https?:\/\/([^.]+)\.supabase\.(?:co|in|net)/i);
  return match ? match[1] : null;
}

export const config = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL || '',
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
};

export interface ValidateConfigOptions {
  url?: string;
  key?: string;
  mode?: string;
}

/**
 * Validates Supabase environment variables at application startup.
 *
 * In Staging mode (mode === 'staging'):
 * 1. Rejects missing URL or Anon Key.
 * 2. Rejects placeholder or unconfigured values.
 * 3. Strictly refuses to start if VITE_SUPABASE_URL points to the primary/production project ('jiicnqgafzvkgfcienpm').
 */
export const validateConfig = (options?: ValidateConfigOptions): boolean => {
  const mode = options?.mode ?? import.meta.env.MODE;
  const url = options?.url ?? config.supabaseUrl;
  const key = options?.key ?? config.supabaseAnonKey;
  const isStaging = mode === 'staging';

  if (!url || !key) {
    const msg = isStaging
      ? '[STAGING CONFIG ERROR] Missing Supabase environment variables for staging. Please configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.staging.'
      : 'Supabase environment variables are missing. Please configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.';
    console.error(msg);
    if (isStaging) {
      throw new Error(msg);
    }
    return false;
  }

  // Refuse placeholder / unconfigured staging variables
  if (isStaging && (url.includes('YOUR_STAGING') || url.includes('<STAGING') || key.includes('YOUR_STAGING') || key.includes('<STAGING'))) {
    const msg = '[STAGING CONFIG ERROR] Staging credentials are using placeholder values. Please populate .env.staging with your dedicated staging Supabase project credentials.';
    console.error(msg);
    throw new Error(msg);
  }

  // Staging isolation guard: strictly refuse if pointing to the primary/production project
  if (isStaging) {
    const ref = extractProjectRef(url);
    if (ref && ref.toLowerCase() === BLOCKED_STAGING_PROJECT_REF.toLowerCase()) {
      const msg = `[STAGING ISOLATION VIOLATION] Staging mode refused to start: VITE_SUPABASE_URL points to the primary/production project reference ('${BLOCKED_STAGING_PROJECT_REF}'). A separate, dedicated Supabase project is strictly required for staging.`;
      console.error(msg);
      throw new Error(msg);
    }
  }

  // Local isolation guard: strictly refuse if local mode points to primary/production project
  if (mode === 'local' || mode === 'localdev') {
    const ref = extractProjectRef(url);
    if (ref && ref.toLowerCase() === BLOCKED_STAGING_PROJECT_REF.toLowerCase()) {
      const msg = `[LOCAL ISOLATION VIOLATION] Local mode refused to start: VITE_SUPABASE_URL points to the primary/production project reference ('${BLOCKED_STAGING_PROJECT_REF}'). Local development must use the local Supabase stack ('http://127.0.0.1:54321').`;
      console.error(msg);
      throw new Error(msg);
    }
  }

  return true;
};

