import React, { useState } from 'react';
import { KeyRound, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { notificationService } from '../../services/notifications/notificationService';
import { passwordChanged } from '../../services/notifications/notificationRules';
import {
  PASSWORD_MESSAGES, PASSWORD_MIN_LENGTH, validatePasswordChange, passwordUpdateErrorMessage, signInErrorMessage, AUTH_MESSAGES,
} from '../../services/auth/authErrors';

/**
 * Change password for a signed-in user (Employee Profile).
 *
 * 1. Verifies the current password by signing in again with the user's own email
 *    (same user, so the app keeps its state; see authEvents 'session-only').
 * 2. Updates the password through Supabase Auth (supabase.auth.updateUser).
 * Passwords are never stored or logged by the app.
 */
const ChangePasswordCard: React.FC = () => {
  const { user, employee } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);

  const clearFields = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    const validationError = validatePasswordChange(currentPassword, newPassword, confirmPassword);
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!user?.email) {
      setError(PASSWORD_MESSAGES.REAUTH);
      return;
    }

    setSaving(true);
    try {
      // 1. Verify the current password
      const { error: verifyError } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword });
      if (verifyError) {
        const msg = signInErrorMessage(verifyError);
        setError(msg === AUTH_MESSAGES.INVALID_CREDENTIALS ? PASSWORD_MESSAGES.CURRENT_INCORRECT : msg);
        return;
      }

      // 2. Update the password
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) {
        if (import.meta.env.DEV) console.warn('[ChangePassword] update failed:', updateError.message);
        setError(passwordUpdateErrorMessage(updateError));
        return;
      }

      clearFields();
      setSuccess(PASSWORD_MESSAGES.SUCCESS);

      // Security notice in the employee's own inbox (no password or other secret in it)
      if (employee?.id) {
        notificationService.notifyEmployee(employee.id, passwordChanged({ employeeId: employee.id, atIso: new Date().toISOString() }));
      }

      import('../../services/audit/auditService').then(({ auditService }) => {
        auditService.recordAuditLog({
          action: 'PASSWORD_CHANGED',
          module: 'AUTH',
          description: 'User changed their password from the profile page',
        }).catch((err: any) => console.error('[AUDIT]', err));
      });
    } catch (err) {
      console.error('[ChangePassword] unexpected error:', err);
      setError(PASSWORD_MESSAGES.GENERIC);
    } finally {
      setSaving(false);
    }
  };

  const labelStyle: React.CSSProperties = { fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)' };

  return (
    <div className="card">
      <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1.5rem', color: 'var(--text-primary)', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <KeyRound size={18} /> CHANGE PASSWORD
      </h3>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '420px' }} autoComplete="off">
        {error && (
          <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem', backgroundColor: 'var(--danger-50)', color: 'var(--danger)', borderRadius: 'var(--radius-md)', fontSize: '0.875rem' }}>
            <AlertCircle size={16} style={{ flexShrink: 0 }} /> {error}
          </div>
        )}
        {success && (
          <div role="status" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem', backgroundColor: 'var(--success-50)', color: 'var(--success)', borderRadius: 'var(--radius-md)', fontSize: '0.875rem' }}>
            <CheckCircle2 size={16} style={{ flexShrink: 0 }} /> {success}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
          <label htmlFor="cp-current" style={labelStyle}>Current password</label>
          <input id="cp-current" type="password" className="form-control" autoComplete="current-password"
            value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} disabled={saving} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
          <label htmlFor="cp-new" style={labelStyle}>New password</label>
          <input id="cp-new" type="password" className="form-control" autoComplete="new-password"
            value={newPassword} onChange={e => setNewPassword(e.target.value)} disabled={saving} />
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>At least {PASSWORD_MIN_LENGTH} characters.</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
          <label htmlFor="cp-confirm" style={labelStyle}>Confirm new password</label>
          <input id="cp-confirm" type="password" className="form-control" autoComplete="new-password"
            value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} disabled={saving} />
        </div>

        <div>
          <button type="submit" className="btn btn-primary" disabled={saving}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', color: 'var(--bg-primary)', fontWeight: 600 }}>
            {saving && <Loader2 size={16} className="spinner" style={{ animation: 'spin 1s linear infinite' }} />}
            {saving ? 'Updating…' : 'Update password'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default ChangePasswordCard;
