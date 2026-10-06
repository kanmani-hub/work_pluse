import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { appSettingsService, type AppSettings } from './appSettingsService';
import { payrollSettingsService, type PayrollSettings } from '../payroll/payrollSettingsService';

export interface GlobalSettings {
  app: AppSettings;
  payroll: PayrollSettings;
  updated_at?: string;
}

class SettingsService {
  private _cache: GlobalSettings | null = null;
  private _listeners: Array<(settings: GlobalSettings) => void> = [];
  private _realtimeInitialized = false;

  subscribe(callback: (settings: GlobalSettings) => void) {
    this._listeners.push(callback);
    if (this._cache) callback(this._cache);
    return () => {
      this._listeners = this._listeners.filter(cb => cb !== callback);
    };
  }

  async loadSettings(): Promise<GlobalSettings> {
    try {
      // @ts-ignore
      const { data, error } = await supabase
        .from('app_settings')
        .select('settings, updated_at')
        .eq('id', '00000000-0000-0000-0000-000000000001')
        .maybeSingle() as any;

      let finalSettings: GlobalSettings = {
        app: appSettingsService.getDefaults(),
        payroll: payrollSettingsService.getDefaults(),
        updated_at: data?.updated_at
      };

      if (!error && data && data.settings) {
        if (data.settings.app) finalSettings.app = { ...finalSettings.app, ...data.settings.app };
        if (data.settings.payroll) finalSettings.payroll = { ...finalSettings.payroll, ...data.settings.payroll };
      }
      
      // Fallback migration from old flat app_settings struct
      if (!error && data && data.settings && !data.settings.app) {
        finalSettings.app = { ...finalSettings.app, ...data.settings };
      }

      this._cache = finalSettings;
      this._listeners.forEach(cb => cb(finalSettings));
      this._initRealtime();
      return finalSettings;
    } catch (e) {
      console.error('Failed to load settings:', e);
      return this._cache || { app: appSettingsService.getDefaults(), payroll: payrollSettingsService.getDefaults() };
    }
  }

  getSettings(): GlobalSettings {
    if (this._cache) return this._cache;
    return {
      app: appSettingsService.getSettings(),
      payroll: payrollSettingsService.getSettings()
    };
  }

  async saveSettings(settings: GlobalSettings): Promise<boolean> {
    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) {
        throw new Error("Authentication required to save settings.");
      }

      // Upsert the single authoritative row
      const { data, error } = await supabase
        .from('app_settings')
        .upsert({ 
          id: '00000000-0000-0000-0000-000000000001', 
          settings: settings 
        } as any, { onConflict: 'id' })
        .select()
        .single();

      if (error) {
        console.error("SUPABASE UPSERT ERROR:", error);
        throw new Error(`Failed to save settings: ${error.message} (${error.code})`);
      }
      
      // According to the user request: "AFTER SAVE, REFETCH"
      await this.loadSettings();
      
      // Sync local storage for offline fallback
      appSettingsService.saveSettings(settings.app);
      payrollSettingsService.saveSettings(settings.payroll);

      import('../audit/auditService').then(({ auditService }) => {
        auditService.recordAuditLog({
          action: 'SETTINGS_UPDATED',
          module: 'SETTINGS',
          description: 'Global company settings were updated.'
        }).catch(e => console.error('[AUDIT]', e));
      });
      
      return true;
    } catch (e: any) {
      console.error('Failed to save settings:', e);
      if (e instanceof Error) {
        throw e;
      }
      throw new Error(String(e));
    }
  }

  private _initRealtime() {
    if (this._realtimeInitialized) return;
    this._realtimeInitialized = true;
    
    supabase
      .channel('global_settings_changes')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'app_settings'
        },
        (payload: any) => {
          if (payload.new && payload.new.settings) {
            let newSettings: GlobalSettings = {
              app: appSettingsService.getDefaults(),
              payroll: payrollSettingsService.getDefaults()
            };
            if (payload.new.settings.app) newSettings.app = { ...newSettings.app, ...payload.new.settings.app };
            if (payload.new.settings.payroll) newSettings.payroll = { ...newSettings.payroll, ...payload.new.settings.payroll };
            
            this._cache = newSettings;
            this._listeners.forEach(cb => cb(newSettings));
          }
        }
      )
      .subscribe();
  }
}

export const globalSettingsService = new SettingsService();


export function useGlobalSettings() {
  const [settings, setSettings] = useState<GlobalSettings>(globalSettingsService.getSettings());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    
    globalSettingsService.loadSettings().then((loaded) => {
      if (isMounted) {
        setSettings(loaded);
        setLoading(false);
      }
    });

    const unsubscribe = globalSettingsService.subscribe((newSettings) => {
      if (isMounted) {
        setSettings(newSettings);
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  return { settings, loading };
}
