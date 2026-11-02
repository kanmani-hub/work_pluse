/**
 * After a new deploy, a browser still running the previous build asks for page chunks that no longer
 * exist ("Failed to fetch dynamically imported module"). The fix is one page reload, which loads the
 * new build. A per-tab guard prevents a reload loop when the failure is something else (offline).
 */
const KEY = 'wp-chunk-reload-at';
const WINDOW_MS = 60_000;

export function isChunkLoadError(err: unknown): boolean {
  const msg = String((err as any)?.message ?? err ?? '');
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|ChunkLoadError|Loading chunk [\w-]+ failed|is not a valid JavaScript MIME type/i.test(msg);
}

/** Reloads once per minute per tab. Returns true when a reload was started. */
export function reloadOnceForNewVersion(nowMs: number = Date.now(), storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeSession(), reload: () => void = () => window.location.reload()): boolean {
  try {
    const last = Number(storage?.getItem(KEY) || 0);
    if (last && nowMs - last < WINDOW_MS) return false;
    storage?.setItem(KEY, String(nowMs));
  } catch {
    // storage unavailable: still reload once (no loop guard possible, but a failed reload shows the error page)
  }
  reload();
  return true;
}

function safeSession(): Storage | null {
  try { return typeof window !== 'undefined' ? window.sessionStorage : null; } catch { return null; }
}

/** Vite fires this when a lazy page's preload/import fails: reload into the new build instead of crashing. */
export function installChunkReloadHandler(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('vite:preloadError', (event: Event) => {
    if (reloadOnceForNewVersion()) event.preventDefault();
  });
}
