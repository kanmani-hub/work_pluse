import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Activity, Eye, EyeOff, AlertCircle, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { isAdminPortalRole } from '../lib/roles';

const Login: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, role, isLoading: isAuthLoading } = useAuth();
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [resetMessage, setResetMessage] = useState('');
  const [loading, setLoading] = useState(false);

  // Redirect if already logged in
  useEffect(() => {
    if (user && !isAuthLoading && role) {
      if (user.user_metadata?.force_password_change) {
        navigate('/change-password', { replace: true });
        return;
      }
      const from = (location.state as any)?.from?.pathname;
      if (from && from !== '/login') {
        navigate(from, { replace: true });
      } else if (isAdminPortalRole(role)) {
        navigate('/admin/dashboard', { replace: true });
      } else {
        navigate('/employee/dashboard', { replace: true });
      }
    }
  }, [user, role, isAuthLoading, navigate, location]);

  const handleForgotPassword = async () => {
    setError('');
    setResetMessage('');
    
    if (!email) {
      setError('Please enter your email address to reset your password.');
      return;
    }

    if (!email.includes('@')) {
      setError('Please enter a valid email address, not an Employee ID.');
      return;
    }

    setLoading(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`
      });

      if (resetError) {
        setError(resetError.message);
      } else {
        setResetMessage('If an account exists for this email, a password reset link has been sent.');
      }
    } catch (err: any) {
      setError('An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email || !password) {
      setError('Please enter both email/ID and password.');
      return;
    }

    setLoading(true);

    try {
      let loginEmail = email.trim();

      // If it doesn't look like an email, assume it's an Employee Code
      if (!loginEmail.includes('@')) {
        const { data: resolvedEmail, error: rpcError } = await (supabase.rpc as any)('get_email_by_employee_code', { 
          p_employee_code: loginEmail 
        });
        
        if (rpcError || !resolvedEmail) {
          setError('Invalid Employee ID or user not found.');
          setLoading(false);
          return;
        }
        
        loginEmail = resolvedEmail;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password,
      });

      if (signInError) {
        setError(signInError.message);
      } else {
        import('../services/audit/auditService').then(({ auditService }) => {
          auditService.recordAuditLog({
            action: 'LOGIN_SUCCESS',
            module: 'AUTH',
            description: `User logged in: ${loginEmail}`
          }).catch((e: any) => console.error('[AUDIT]', e));
        });
      }
      // If successful, the AuthContext listener will detect SIGNED_IN and handle navigation
    } catch (err) {
      console.error(err);
      setError('An unexpected network error occurred.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg-primary)', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div className="card" style={{ width: '100%', maxWidth: '440px', padding: '2.5rem', display: 'flex', flexDirection: 'column', gap: '2rem', backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--shadow-lg)' }}>
        
        {/* Header */}
        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ color: 'var(--primary-500)', background: 'var(--primary-50)', padding: '1rem', borderRadius: '50%', boxShadow: '0 0 20px rgba(124, 92, 255, 0.15)' }}>
            <Activity size={32} strokeWidth={2.5} />
          </div>
          <div>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.25rem', letterSpacing: '-0.02em' }}>WorkPulse HR</h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Employee Attendance & Workforce Management</p>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {error && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem', backgroundColor: 'var(--danger-50)', color: 'var(--danger)', borderRadius: 'var(--radius-md)', fontSize: '0.875rem' }}>
              <AlertCircle size={16} />
              {error}
            </div>
          )}

          {resetMessage && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem', backgroundColor: 'var(--success-50)', color: 'var(--success)', borderRadius: 'var(--radius-md)', fontSize: '0.875rem' }}>
              {resetMessage}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>Email or Employee ID</label>
            <input 
              type="text" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email address"
              style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-surface-elevated)', color: 'var(--text-primary)', outline: 'none', fontSize: '0.875rem', transition: 'all var(--transition-fast)' }}
              onFocus={(e) => { e.target.style.borderColor = 'var(--primary-500)'; e.target.style.boxShadow = '0 0 0 3px rgba(124, 92, 255, 0.1)'; }}
              onBlur={(e) => { e.target.style.borderColor = 'var(--border-color)'; e.target.style.boxShadow = 'none'; }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>Password</label>
              <button 
                type="button" 
                onClick={handleForgotPassword}
                disabled={loading}
                style={{ fontSize: '0.75rem', color: 'var(--primary-600)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', opacity: loading ? 0.7 : 1, padding: '0.5rem', margin: '-0.5rem' }}
              >
                Forgot password?
              </button>
            </div>
            <div style={{ position: 'relative' }}>
              <input 
                type={showPassword ? 'text' : 'password'} 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                style={{ width: '100%', padding: '0.75rem 2.5rem 0.75rem 0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-surface-elevated)', color: 'var(--text-primary)', outline: 'none', fontSize: '0.875rem', transition: 'all var(--transition-fast)' }}
                onFocus={(e) => { e.target.style.borderColor = 'var(--primary-500)'; e.target.style.boxShadow = '0 0 0 3px rgba(124, 92, 255, 0.1)'; }}
                onBlur={(e) => { e.target.style.borderColor = 'var(--border-color)'; e.target.style.boxShadow = 'none'; }}
              />
              <button 
                type="button"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword(!showPassword)}
                style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer', padding: '0.5rem', minHeight: '44px', minWidth: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
            <input type="checkbox" id="remember" style={{ cursor: 'pointer', accentColor: 'var(--primary-600)', width: '16px', height: '16px' }} />
            <label htmlFor="remember" style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', cursor: 'pointer', fontWeight: 500 }}>Remember me for 30 days</label>
          </div>

          <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '0.875rem', fontSize: '1rem', marginTop: '0.75rem', color: 'var(--bg-primary)', fontWeight: 600 }} disabled={loading}>
            {loading ? <Loader2 size={20} className="spinner" /> : 'Log in'}
          </button>
        </form>
      </div>

      <style>{`
        .spinner { animation: spin 1s linear infinite; }
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
    </main>
  );
};

export default Login;


