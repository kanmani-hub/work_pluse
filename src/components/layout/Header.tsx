import React, { useState, useRef, useEffect } from 'react';
import { Menu, Bell, CheckCircle2, Search, Command, Sun, Moon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { notificationService } from '../../services/notifications/notificationService';
import { realtimeService } from '../../services/realtime/realtimeService';

interface HeaderProps {
  toggleMenu: () => void;
  role: 'admin' | 'employee';
}

const Header: React.FC<HeaderProps> = ({ toggleMenu, role }) => {
  const navigate = useNavigate();
  const [showDropdown, setShowDropdown] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<any[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { theme, toggleTheme } = useTheme();
  const { employee, role: actualRole } = useAuth();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    
    // Fetch initial count
    const fetchCount = async () => {
      const { count } = await notificationService.getUnreadNotificationCount();
      setUnreadCount(count);
    };

    const fetchNotifications = async () => {
      const { data } = await notificationService.getMyNotifications();
      if (data) setNotifications(data.slice(0, 5)); // show top 5
    };
    
    if (employee?.id) {
      fetchCount();
      fetchNotifications();
      
      // Subscribe to realtime notifications
      const channel = realtimeService.subscribeToNotifications(employee.id, (payload) => {
        // Simple logic: re-fetch count when any change happens to this employee's notifications
        fetchCount();
        fetchNotifications();
      });
      
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
        realtimeService.unsubscribe(channel);
      };
    }

    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [employee]);

  const handleNotificationClick = () => {
    setShowDropdown(!showDropdown);
  };

  const handleViewAll = () => {
    setShowDropdown(false);
    navigate(role === 'admin' ? '/admin/notifications' : '/employee/notifications');
  };

  const displayName = employee ? `${employee.first_name} ${employee.last_name}` : (role === 'admin' ? 'System Admin' : 'Employee');
  const initials = employee ? `${employee.first_name.charAt(0)}${employee.last_name.charAt(0)}` : (role === 'admin' ? 'SA' : 'EM');
  const displayRole = actualRole || (role === 'admin' ? 'Admin' : 'Employee');

  return (
    <header className="header">
      <div className="header-left">
        <button className="menu-toggle" onClick={toggleMenu} aria-label="Toggle Menu">
          <Menu size={24} />
        </button>
        
        <div className="mobile-logo" style={{ display: 'none', fontWeight: 700, fontSize: '1.125rem', color: 'var(--text-primary)', marginLeft: '0.5rem' }} id="mobile-header-logo">
          WorkPulse HR
        </div>
        <style>{`
          @media (max-width: 1023px) {
            #mobile-header-logo { display: block !important; }
          }
        `}</style>
        
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
                <button onClick={async () => {
                  await notificationService.markAllNotificationsAsRead();
                  setUnreadCount(0);
                  const { data } = await notificationService.getMyNotifications();
                  if (data) setNotifications(data.slice(0, 5));
                }} style={{ background: 'none', border: 'none', color: 'var(--primary-400)', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  <CheckCircle2 size={14}/> Mark all as read
                </button>
              </div>
              <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
                {notifications.length === 0 ? (
                  <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                    No notifications yet
                  </div>
                ) : (
                  notifications.map(notif => (
                    <div 
                      key={notif.id}
                      style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border-color)', backgroundColor: notif.is_read ? 'transparent' : 'rgba(255,255,255,0.02)', cursor: 'pointer' }} 
                      onClick={async () => {
                        if (!notif.is_read) {
                          await notificationService.markNotificationAsRead(notif.id);
                          setUnreadCount(prev => Math.max(0, prev - 1));
                          const { data } = await notificationService.getMyNotifications();
                          if (data) setNotifications(data.slice(0, 5));
                        }
                        if (notif.action_url) {
                          setShowDropdown(false);
                          navigate(notif.action_url);
                        } else {
                          handleViewAll();
                        }
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                        <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>{notif.title}</div>
                        <span style={{ fontSize: '0.7rem', color: notif.notification_type === 'Attendance' ? 'var(--warning)' : 'var(--primary-400)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{notif.notification_type}</span>
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>{notif.message}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{new Date(notif.created_at).toLocaleString('en-GB')}</div>
                    </div>
                  ))
                )}
              </div>
              <div style={{ padding: '0.75rem', borderTop: '1px solid var(--border-color)', textAlign: 'center', backgroundColor: 'var(--bg-surface)' }}>
                <button onClick={handleViewAll} style={{ background: 'none', border: 'none', color: 'var(--primary-400)', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', width: '100%' }}>View all notifications</button>
              </div>
            </div>
          )}
        </div>
        
        <div className="user-profile" onClick={() => navigate(role === 'admin' ? '/admin/settings' : '/employee/profile')}>
          <div className="avatar">
            {initials}
          </div>
          <div className="user-info" style={{ paddingRight: '0.5rem', display: 'none' }} id="desktop-user">
            <span className="user-name">
              {displayName}
            </span>
            <span className="user-role">
              {displayRole}
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



