import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, Eye, EyeOff, AlertCircle, Loader2 } from 'lucide-react';

const Login: React.FC = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('EMP001');
  const [password, setPassword] = useState('password123');
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole] = useState<'employee' | 'hr' | 'admin'>('employee');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email || !password) {
      setError('Please enter both email/ID and password.');
      return;
    }

    if (email === 'error') {
      setError('Invalid credentials. Please try again.');
      return;
    }

    setLoading(true);

    // Simulate API call
    setTimeout(() => {
      setLoading(false);
      if (role === 'employee') {
        navigate('/employee/dashboard');
      } else {
        navigate('/admin/dashboard'); // HR and Admin go to main dashboard for now
      }
    }, 1000);
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg-primary)', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
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

        {/* Prototype Role Selector */}
        <div style={{ padding: '0.5rem', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', display: 'flex', gap: '0.5rem' }}>
            {(['employee', 'hr', 'admin'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className="btn"
                style={{ 
                  flex: 1, padding: '0.5rem 0', fontSize: '0.75rem', textTransform: 'capitalize', fontWeight: 600, border: 'none',
                  background: role === r ? 'linear-gradient(135deg, var(--primary-600), var(--primary-500))' : 'transparent',
                  color: role === r ? '#fff' : 'var(--text-secondary)',
                  boxShadow: role === r ? '0 4px 15px rgba(124, 92, 255, 0.3)' : 'none'
                }}
              >
                {r === 'hr' ? 'HR/Staff' : r}
              </button>
            ))}
          </div>

        {/* Form */}
        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {error && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem', backgroundColor: 'var(--danger-50)', color: 'var(--danger)', borderRadius: 'var(--radius-md)', fontSize: '0.875rem' }}>
              <AlertCircle size={16} />
              {error}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>Email or Employee ID</label>
            <input 
              type="text" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. EMP001"
              style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-surface-elevated)', color: 'var(--text-primary)', outline: 'none', fontSize: '0.875rem', transition: 'all var(--transition-fast)' }}
              onFocus={(e) => { e.target.style.borderColor = 'var(--primary-500)'; e.target.style.boxShadow = '0 0 0 3px rgba(124, 92, 255, 0.1)'; }}
              onBlur={(e) => { e.target.style.borderColor = 'var(--border-color)'; e.target.style.boxShadow = 'none'; }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>Password</label>
              <button type="button" style={{ fontSize: '0.75rem', color: 'var(--primary-500)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer' }}>Forgot password?</button>
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
                onClick={() => setShowPassword(!showPassword)}
                style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}
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
    </div>
  );
};

export default Login;


