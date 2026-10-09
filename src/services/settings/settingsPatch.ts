/**
 * Save individual app settings (app_settings.settings.app) from other admin pages using the
 * existing single-row settings mechanism (globalSettingsService). The latest row is loaded
 * first, only the given keys are changed, and success is reported ONLY when the re-fetched
 * row (saveSettings re-fetches after the upsert) contains the new values.
 */
import { supabase } from '../../lib/supabase';
import { globalSettingsService } from './globalSettingsService';
import type { AppSettings } from './appSettingsService';
import { buildPatchedSettings, patchConfirmed } from './settingsPatchRules';
export { buildPatchedSettings, patchConfirmed, mergeAppPatch } from './settingsPatchRules';

export const SETTINGS_ROW_ID = '00000000-0000-0000-0000-000000000001';

export async function saveAppSettingsPatch(patch: Partial<AppSettings>): Promise<{ ok: boolean; error: string | null }> {
  try {
    const { data, error } = await (supabase.from('app_settings') as any)
      .select('settings').eq('id', SETTINGS_ROW_ID).maybeSingle();
    if (error) return { ok: false, error: `Could not read current settings: ${error.message}` };
    const next = buildPatchedSettings(data?.settings, patch as any);
    if (!next) return { ok: false, error: 'Company settings have not been saved in the expected format yet. Save them once from Admin → Settings, then try again.' };
    await globalSettingsService.saveSettings(next); // upsert + re-fetch (throws on failure)
    const confirmed = globalSettingsService.getSettings();
    if (!patchConfirmed(confirmed.app as any, patch as any)) {
      return { ok: false, error: 'The setting could not be confirmed after saving. Please refresh and try again.' };
    }
    return { ok: true, error: null };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/** Read the stored app settings directly. app = null when the read failed or nothing is stored. */
export async function loadStoredAppSettings(): Promise<{ app: Record<string, any> | null; error: string | null }> {
  try {
    const { data, error } = await (supabase.from('app_settings') as any)
      .select('settings').eq('id', SETTINGS_ROW_ID).maybeSingle();
    if (error) return { app: null, error: error.message };
    const app = data?.settings?.app;
    if (!app || typeof app !== 'object') return { app: null, error: 'No saved company settings found.' };
    return { app, error: null };
  } catch (e: any) {
    return { app: null, error: e?.message || String(e) };
  }
}
