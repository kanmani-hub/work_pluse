import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert, LogOut, Loader2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { accountErrorMessage, type AuthAccountErrorCode } from '../../services/auth/authErrors';

/**
 * Shown instead of a portal when a signed-in account cannot use the app
 * (no employee profile / no or unknown role). Replaces the old redirect, which could
 * loop forever. Offers a single safe action: sign out and return to the login page.
 */
const AccountAccessError: React.FC<{ code: AuthAccountErrorCode }> = ({ code }) => {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const handleSignOut = async () => {
    setBusy(true);
    try {
      await signOut();
    } finally {
      navigate('/login', { replace: true });
    }
  };

  return (
    <main style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg-primary)', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div className="card" role="alert" style={{ width: '100%', maxWidth: '440px', padding: '2.5rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.25rem', textAlign: 'center', backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--shadow-lg)' }}>
        <div style={{ color: 'var(--danger)', background: 'var(--danger-50)', padding: '1rem', borderRadius: '50%' }}>
          <ShieldAlert size={32} strokeWidth={2.5} />
        </div>
        <div>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>Unable to open WorkPulse HR</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9375rem' }}>{accountErrorMessage(code)}</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={handleSignOut} disabled={busy}
          style={{ width: '100%', padding: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', color: 'var(--bg-primary)', fontWeight: 600 }}>
          {busy ? <Loader2 size={18} className="spinner" /> : <LogOut size={18} />}
          Sign out and return to login
        </button>
      </div>
      <style>{`.spinner { animation: spin 1s linear infinite; } @keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
    </main>
  );
};

export default AccountAccessError;
