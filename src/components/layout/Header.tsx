import React, { useState, useRef, useEffect } from 'react';
import { Menu, Bell, CheckCircle2, Search, Command, Sun, Moon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../../context/ThemeContext';

interface HeaderProps {
  toggleMenu: () => void;
  role: 'admin' | 'employee';
}

const Header: React.FC<HeaderProps> = ({ toggleMenu, role }) => {
  const navigate = useNavigate();
  const [showDropdown, setShowDropdown] = useState(false);
  const [unreadCount, setUnreadCount] = useState(5);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleNotificationClick = () => {
    setShowDropdown(!showDropdown);
  };

  const handleViewAll = () => {
    setShowDropdown(false);
    navigate(role === 'admin' ? '/admin/notifications' : '/employee/notifications');
  };

  return (
    <header className="header">
      <div className="header-left">
        <button className="menu-toggle" onClick={toggleMenu} aria-label="Toggle Menu">
          <Menu size={24} />
        </button>
        
        <div className="command-search" style={{ display: 'none' }} id="desktop-search">
          <Search size={16} style={{ color: 'var(--text-muted)' }} />
          <input type="text" placeholder="Search WorkPulse..." />
          <span className="shortcut-hint">Ctrl K</span>
        </div>
        
        <style>{`
          @media (min-width: 1024px) {
            #desktop-search { display: flex !important; }
          }
        `}</style>
      </div>
      
      <div className="header-right">
        
        <div style={{ display: 'flex', alignItems: 'center', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-full)', padding: '0.25rem', border: '1px solid var(--border-color)', gap: '0.25rem', marginRight: '0.5rem' }}>
          <button 
            onClick={() => theme !== 'light' && toggleTheme()}
            style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.375rem 0.75rem', borderRadius: 'var(--radius-full)', fontSize: '0.75rem', fontWeight: 600, backgroundColor: theme === 'light' ? 'var(--primary-500)' : 'transparent', color: theme === 'light' ? '#fff' : 'var(--text-secondary)', transition: 'all var(--transition-fast)' }}
          >
            <Sun size={14} /> <span style={{ display: 'none' }} id="desktop-theme-text-light">Light</span>
          </button>
          <button 
            onClick={() => theme !== 'dark' && toggleTheme()}
            style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.375rem 0.75rem', borderRadius: 'var(--radius-full)', fontSize: '0.75rem', fontWeight: 600, backgroundColor: theme === 'dark' ? 'var(--primary-500)' : 'transparent', color: theme === 'dark' ? '#fff' : 'var(--text-secondary)', transition: 'all var(--transition-fast)' }}
          >
            <Moon size={14} /> <span style={{ display: 'none' }} id="desktop-theme-text-dark">Dark</span>
          </button>
          <style>{`
            @media (min-width: 768px) {
              #desktop-theme-text-light, #desktop-theme-text-dark { display: inline !important; }
            }
          `}</style>
        </div>

        <div className="system-status">
          <div className="status-dot"></div>
          SYSTEM LIVE
        </div>

        <div style={{ position: 'relative' }} ref={dropdownRef}>
          <button className="icon-button" onClick={handleNotificationClick} aria-label="Notifications">
            <div style={{ position: 'relative' }}>
              <Bell size={18} />
              {unreadCount > 0 && (
                <span style={{ 
                  position: 'absolute', top: '-6px', right: '-6px', 
                  backgroundColor: 'var(--danger)', color: 'var(--bg-primary)',
                  borderRadius: '10px', padding: '0 4px', fontSize: '0.6rem',
                  fontWeight: 700, border: '2px solid var(--bg-surface)', minWidth: '16px', textAlign: 'center'
                }}>
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </div>
          </button>
          
          {showDropdown && (
            <div style={{ 
              position: 'absolute', top: 'calc(100% + 1rem)', right: 0, 
              width: '350px', backgroundColor: 'var(--bg-surface-elevated)', 
              boxShadow: 'var(--shadow-lg)', borderRadius: 'var(--radius-xl)', 
              border: '1px solid var(--border-color)', zIndex: 50,
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
              animation: 'fadeIn var(--transition-fast)'
            }}>
              <div style={{ padding: '1rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontSize: '0.875rem', fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>Notifications</h3>
                <button onClick={() => setUnreadCount(0)} style={{ background: 'none', border: 'none', color: 'var(--primary-400)', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  <CheckCircle2 size={14}/> Mark all as read
                </button>
              </div>
              <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
                <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border-color)', backgroundColor: 'rgba(255,255,255,0.02)', cursor: 'pointer' }} onClick={handleViewAll}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                    <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>Leave Request Approved</div>
                    <span style={{ fontSize: '0.7rem', color: 'var(--primary-400)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Leave</span>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Your leave request for 28 Sep has been approved.</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>10 minutes ago</div>
                </div>
                <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border-color)', backgroundColor: 'rgba(255,255,255,0.02)', cursor: 'pointer' }} onClick={handleViewAll}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                    <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>Late Login Detected</div>
                    <span style={{ fontSize: '0.7rem', color: 'var(--warning)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Attendance</span>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>You logged in 18 minutes after your scheduled shift start.</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>1 hour ago</div>
                </div>
                <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border-color)', backgroundColor: 'rgba(255,255,255,0.02)', cursor: 'pointer' }} onClick={handleViewAll}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                    <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>Missing Attendance Punch</div>
                    <span style={{ fontSize: '0.7rem', color: 'var(--danger)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Attendance</span>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Your attendance record is missing a logout entry.</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>2 hours ago</div>
                </div>
              </div>
              <div style={{ padding: '0.75rem', borderTop: '1px solid var(--border-color)', textAlign: 'center', backgroundColor: 'var(--bg-surface)' }}>
                <button onClick={handleViewAll} style={{ background: 'none', border: 'none', color: 'var(--primary-400)', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', width: '100%' }}>View all notifications</button>
              </div>
            </div>
          )}
        </div>
        
        <div className="user-profile" onClick={() => navigate(role === 'admin' ? '/admin/settings' : '/employee/profile')}>
          <div className="avatar">
            {role === 'admin' ? 'JD' : 'AK'}
          </div>
          <div className="user-info" style={{ paddingRight: '0.5rem', display: 'none' }} id="desktop-user">
            <span className="user-name">
              {role === 'admin' ? 'John Doe' : 'Arun Kumar'}
            </span>
            <span className="user-role">
              {role === 'admin' ? 'Admin' : 'Software Developer'}
            </span>
          </div>
          <style>{`
            @media (min-width: 768px) {
              #desktop-user { display: flex !important; }
            }
          `}</style>
        </div>
      </div>
    </header>
  );
};

export default Header;



