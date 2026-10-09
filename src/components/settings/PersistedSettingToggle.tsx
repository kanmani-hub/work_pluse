import React, { useCallback, useEffect, useState } from 'react';
import { loadStoredAppSettings, saveAppSettingsPatch } from '../../services/settings/settingsPatch';
import { appSettingsService } from '../../services/settings/appSettingsService';

/**
 * Loads the stored app settings once for a settings drawer. `app` is null until a successful
 * read, so toggles never show a default value as if it were the saved one.
 */
export function useStoredAppSettings() {
  const [app, setApp] = useState<Record<string, any> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    const res = await loadStoredAppSettings();
    setApp(res.app);
    setError(res.error);
    setLoading(false);
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { app, error, loading, reload, setApp };
}

interface Props {
  settingKey: string;
  label: string;
  description?: string;
  /** Shown under the switch: whether the app currently acts on this setting. */
  enforcementNote?: string;
  stored: { app: Record<string, any> | null; loading: boolean; setApp: (a: Record<string, any> | null) => void };
}

/** A switch bound to app_settings.settings.app[settingKey]; reports "Saved" only after the save is confirmed. */
export const PersistedSettingToggle: React.FC<Props> = ({ settingKey, label, description, enforcementNote, stored }) => {
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const available = !!stored.app;
  const raw = stored.app ? stored.app[settingKey] : undefined;
  // A key never saved before falls back to the app default (same as the rest of the app).
  const value = raw === undefined ? !!(appSettingsService.getDefaults() as any)[settingKey] : !!raw;

  const onChange = async (checked: boolean) => {
    setSaving(true);
    setStatus(null);
    const res = await saveAppSettingsPatch({ [settingKey]: checked } as any);
    if (res.ok && stored.app) {
      stored.setApp({ ...stored.app, [settingKey]: checked });
      setStatus({ ok: true, msg: 'Saved' });
    } else {
      setStatus({ ok: false, msg: res.error || 'Not saved' });
    }
    setSaving(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
        <div>
          <div style={{ fontSize: '0.875rem', fontWeight: 600 }}>{label}</div>
          {description && <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{description}</div>}
        </div>
        <input
          type="checkbox"
          aria-label={label}
          checked={value}
          disabled={!available || stored.loading || saving}
          onChange={e => onChange(e.target.checked)}
          style={{ cursor: available && !saving ? 'pointer' : 'not-allowed' }}
        />
      </div>
      {enforcementNote && <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{enforcementNote}</div>}
      {saving && <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Saving…</div>}
      {status && <div style={{ fontSize: '0.75rem', color: status.ok ? 'var(--success)' : 'var(--danger)' }}>{status.msg}</div>}
    </div>
  );
};
