import React, { useState, useEffect } from 'react';
import { 
  Bell, Search, Filter, CheckCircle2, Trash2, X, Settings,
  AlertTriangle, ShieldAlert, FileText, Clock, MapPin, 
  CalendarDays, Briefcase, Activity, ChevronRight
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { notificationService } from '../services/notifications/notificationService';
import { realtimeService } from '../services/realtime/realtimeService';
import { toNotificationItem, mergeNotificationRows, type NotificationRowLike } from '../services/notifications/notificationRules';

const Notifications: React.FC = () => {
  const navigate = useNavigate();
  const { employee } = useAuth();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  // Database rows (own notifications only); mapped to display items below
  const [rows, setRows] = useState<NotificationRowLike[]>([]);
  const notifications = rows.map(r => toNotificationItem(r, Date.now()));
  const [selectedNotif, setSelectedNotif] = useState<any>(null);
  
  // Filters
  const [statusFilter, setStatusFilter] = useState('All');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [priorityFilter, setPriorityFilter] = useState('All');
  const [dateFilter, setDateFilter] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');

  // Preference Drawer
  const [showPreferences, setShowPreferences] = useState(false);

  // Load + realtime (INSERT and UPDATE for this employee only). Refetch on (re)subscribe and when
  // the browser comes back online, so nothing created while offline is missed; rows merge by id.
  useEffect(() => {
    if (!employee?.id) return;
    let cancelled = false;
    const load = async () => {
      const { data, error } = await notificationService.getMyNotifications();
      if (cancelled) return;
      if (error) setLoadError(true);
      else { setLoadError(false); setRows(prev => mergeNotificationRows(prev, (data || []) as any)); }
      setLoading(false);
    };
    load();
    const channel = realtimeService.subscribeToNotifications(employee.id, (payload: any) => {
      if (payload?.new?.id) setRows(prev => mergeNotificationRows(prev, [payload.new]));
    }, 'page', load);
    const onOnline = () => load();
    window.addEventListener('online', onOnline);
    return () => {
      cancelled = true;
      window.removeEventListener('online', onOnline);
      realtimeService.unsubscribe(channel);
    };
  }, [employee?.id]);

  const handleMarkAllRead = async () => {
    const { error } = await notificationService.markAllNotificationsAsRead();
    if (!error) {
      const nowIso = new Date().toISOString();
      setRows(prev => prev.map(r => (r.is_read ? r : { ...r, is_read: true, read_at: nowIso })));
    }
  };

  const handleClearRead = async () => {
    if (window.confirm('Clear read notifications? They will be removed from your list.')) {
      const { error } = await notificationService.clearReadNotifications();
      if (!error) setRows(prev => prev.filter(r => !r.is_read));
    }
  };

  const handleMarkRead = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const { error } = await notificationService.markNotificationAsRead(id);
    if (!error) {
      const nowIso = new Date().toISOString();
      setRows(prev => prev.map(r => (r.id === id ? { ...r, is_read: true, read_at: nowIso } : r)));
    }
  };

  const handleOpenDrawer = (notif: any) => {
    setSelectedNotif(notif);
    if (!notif.read) {
      handleMarkRead(notif.id);
    }
  };

  const getCategoryIcon = (cat: string) => {
    switch (cat) {
      case 'Attendance': return <Clock size={16} color="var(--warning-600)" />;
      case 'Leave': return <CalendarDays size={16} color="var(--primary-600)" />;
      case 'WFH': return <MapPin size={16} color="var(--purple-600)" />;
      case 'Permission': return <Activity size={16} color="var(--info-600)" />;
      case 'Payroll': return <FileText size={16} color="var(--success-600)" />;
      case 'Shift': return <Briefcase size={16} color="var(--gray-600)" />;
      case 'Security': return <ShieldAlert size={16} color="var(--danger-600)" />;
      default: return <Bell size={16} color="var(--gray-600)" />;
    }
  };

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'Critical': return <span className="badge badge-danger">Critical</span>;
      case 'High': return <span className="badge badge-warning">High</span>;
      case 'Normal': return <span className="badge badge-gray">Normal</span>;
      default: return null;
    }
  };

  const filteredNotifications = notifications.filter(n => {
    if (statusFilter === 'Unread' && n.read) return false;
    if (statusFilter === 'Read' && !n.read) return false;
    if (categoryFilter !== 'All' && n.category !== categoryFilter) return false;
    if (priorityFilter !== 'All' && n.priority !== priorityFilter) return false;
    if (searchQuery && !n.title.toLowerCase().includes(searchQuery.toLowerCase()) && !n.message.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    // Simple date filter logic for prototype
    if (dateFilter === 'Today' && n.date !== 'Today') return false;
    if (dateFilter === 'This Week' && n.date === 'Earlier') return false;
    return true;
  });

  const unreadCount = notifications.filter(n => !n.read).length;
  const criticalCount = notifications.filter(n => n.priority === 'Critical' || n.priority === 'High').length;
  const todayCount = notifications.filter(n => n.date === 'Today').length;

  const renderGroup = (groupName: string) => {
    const groupNotifs = filteredNotifications.filter(n => n.date === groupName);
    if (groupNotifs.length === 0) return null;

    return (
      <div style={{ marginBottom: '1.5rem' }}>
        <h4 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{groupName}</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {groupNotifs.map(n => (
            <div key={n.id} onClick={() => handleOpenDrawer(n)} style={{ 
              display: 'flex', gap: '1rem', padding: '1rem', borderRadius: 'var(--radius-md)', 
              backgroundColor: n.read ? 'var(--bg-surface)' : 'var(--primary-50)', 
              border: '1px solid', borderColor: n.read ? 'var(--border-color)' : 'var(--primary-200)',
              cursor: 'pointer', transition: 'all 0.2s', position: 'relative'
            }}>
              {!n.read && <div style={{ position: 'absolute', top: '1rem', left: '-4px', width: '8px', height: '8px', backgroundColor: 'var(--primary-500)', borderRadius: '50%' }}></div>}
              
              <div style={{ padding: '0.5rem', backgroundColor: n.read ? 'var(--gray-50)' : 'var(--bg-surface)', borderRadius: 'var(--radius-md)', height: 'fit-content' }}>
                {getCategoryIcon(n.category)}
              </div>
              
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.25rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <h4 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: n.read ? 500 : 600, color: 'var(--text-primary)' }}>{n.title}</h4>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    <span>{n.time}</span>
                    {getPriorityBadge(n.priority)}
                  </div>
                </div>
                <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{n.message}</p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center' }}>
                {!n.read && (
                  <button onClick={(e) => handleMarkRead(n.id, e)} style={{ background: 'none', border: 'none', padding: '0.25rem', cursor: 'pointer', color: 'var(--primary-600)' }} title="Mark as Read">
                    <CheckCircle2 size={18} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      
      {/* Header */}
      <div className="page-header" style={{ marginBottom: 0, flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="page-title">Notifications</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>Stay updated with attendance, leave, payroll and security activity.</p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={() => setShowPreferences(true)} className="btn btn-outline" style={{ fontSize: '0.875rem' }}><Settings size={16}/> Settings</button>
          <button onClick={handleClearRead} className="btn btn-outline" style={{ fontSize: '0.875rem', color: 'var(--danger)', borderColor: 'var(--danger-300)' }}><Trash2 size={16}/> Clear Read</button>
          <button onClick={handleMarkAllRead} className="btn btn-primary" style={{ fontSize: '0.875rem' }}><CheckCircle2 size={16}/> Mark All as Read</button>
        </div>
      </div>

      {loading ? (
        <div className="skeleton" style={{ height: '100px', borderRadius: 'var(--radius-md)' }} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          <div className="card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Total Notifications</div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700 }}>{notifications.length}</div>
          </div>
          <div className="card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', backgroundColor: unreadCount > 0 ? 'var(--primary-50)' : 'var(--bg-surface)' }}>
            <div style={{ fontSize: '0.875rem', color: unreadCount > 0 ? 'var(--primary-700)' : 'var(--gray-500)', fontWeight: 500 }}>Unread</div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: unreadCount > 0 ? 'var(--primary-700)' : 'inherit' }}>{unreadCount}</div>
          </div>
          <div className="card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', backgroundColor: criticalCount > 0 ? 'var(--danger-50)' : 'var(--bg-surface)' }}>
            <div style={{ fontSize: '0.875rem', color: criticalCount > 0 ? 'var(--danger)' : 'var(--gray-500)', fontWeight: 500 }}>Important / Critical</div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: criticalCount > 0 ? 'var(--danger)' : 'inherit' }}>{criticalCount}</div>
          </div>
          <div className="card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Today</div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700 }}>{todayCount}</div>
          </div>
        </div>
      )}

      {/* Filter Bar */}
      <div className="card" style={{ padding: '1rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', backgroundColor: 'var(--bg-surface-elevated)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderRight: '1px solid var(--border-color)', paddingRight: '1rem' }}>
          <Filter size={18} color="var(--gray-500)" />
          <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>Filters</span>
        </div>
        
        <select className="form-control" style={{ width: 'auto', fontSize: '0.875rem' }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option>All</option><option>Unread</option><option>Read</option>
        </select>
        
        <select className="form-control" style={{ width: 'auto', fontSize: '0.875rem' }} value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
          <option>All</option><option>Attendance</option><option>Leave</option><option>WFH</option><option>Permission</option><option>Payroll</option><option>Shift</option><option>Security</option>
        </select>
        
        <select className="form-control" style={{ width: 'auto', fontSize: '0.875rem' }} value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}>
          <option>All</option><option>Critical</option><option>High</option><option>Normal</option>
        </select>

        <select className="form-control" style={{ width: 'auto', fontSize: '0.875rem' }} value={dateFilter} onChange={e => setDateFilter(e.target.value)}>
          <option>All</option><option>Today</option><option>This Week</option>
        </select>

        <div style={{ position: 'relative', flex: 1, minWidth: '200px' }}>
          <Search size={14} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
          <input type="text" placeholder="Search notifications..." className="form-control" style={{ paddingLeft: '2rem', fontSize: '0.875rem' }} value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
        </div>
        
        { (statusFilter !== 'All' || categoryFilter !== 'All' || priorityFilter !== 'All' || dateFilter !== 'All' || searchQuery !== '') && (
          <button onClick={() => { setStatusFilter('All'); setCategoryFilter('All'); setPriorityFilter('All'); setDateFilter('All'); setSearchQuery(''); }} className="btn btn-outline" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>Reset</button>
        )}
      </div>

      {loading ? (
        <div className="skeleton" style={{ height: '400px', borderRadius: 'var(--radius-lg)' }} />
      ) : loadError && notifications.length === 0 ? (
        <div className="card" role="alert" style={{ textAlign: 'center', color: 'var(--danger)' }}>
          Unable to load your notifications. Check your connection and refresh the page.
        </div>
      ) : filteredNotifications.length === 0 ? (
        <div className="card" style={{ padding: '4rem', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <Bell size={48} color="var(--gray-300)" style={{ marginBottom: '1rem' }}/>
          <h3 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)' }}>You're all caught up!</h3>
          <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem' }}>{notifications.length === 0 ? 'There are no notifications to display.' : 'No matching notifications found. Try changing your filters.'}</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {renderGroup('Today')}
          {renderGroup('Yesterday')}
          {renderGroup('Earlier This Week')}
          {renderGroup('Earlier')}
        </div>
      )}

      {/* Notification Detail Drawer */}
      {selectedNotif && (
        <div className="drawer-overlay" onClick={() => setSelectedNotif(null)}>
          <div className="drawer detail-drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header" style={{ alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{ padding: '0.5rem', backgroundColor: 'var(--gray-100)', borderRadius: 'var(--radius-md)' }}>
                  {getCategoryIcon(selectedNotif.category)}
                </div>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>Notification Detail</h2>
              </div>
              <button className="icon-button" onClick={() => setSelectedNotif(null)}><X size={20} /></button>
            </div>
            
            <div className="drawer-body" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              
              <div>
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <span className="badge badge-gray">{selectedNotif.category}</span>
                  {getPriorityBadge(selectedNotif.priority)}
                </div>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)', marginTop: '1rem', marginBottom: '0.5rem' }}>{selectedNotif.title}</h3>
                <p style={{ fontSize: '1rem', color: 'var(--gray-700)', lineHeight: 1.6 }}>{selectedNotif.message}</p>
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '1rem', backgroundColor: 'var(--gray-50)', borderRadius: 'var(--radius-md)', border: '1px solid var(--gray-200)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Date</span>
                  <span style={{ fontWeight: 500 }}>{selectedNotif.fullDate}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Time</span>
                  <span style={{ fontWeight: 500 }}>{selectedNotif.time}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Status</span>
                  <span style={{ fontWeight: 500 }}>{selectedNotif.read ? 'Read' : 'Unread'}</span>
                </div>
              </div>

              <div style={{ marginTop: 'auto', paddingTop: '2rem' }}>
                <button 
                  className="btn btn-primary" 
                  style={{ width: '100%', display: 'flex', justifyContent: 'center', padding: '0.75rem' }}
                  onClick={() => { setSelectedNotif(null); if(selectedNotif.actionRoute !== '#') navigate(selectedNotif.actionRoute); }}
                >
                  View {selectedNotif.relatedModule} Details <ChevronRight size={18} style={{ marginLeft: '0.5rem' }}/>
                </button>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* Preferences Drawer */}
      {showPreferences && (
        <div className="drawer-overlay" onClick={() => setShowPreferences(false)}>
          <div className="drawer detail-drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header" style={{ alignItems: 'center' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>My Notification Preferences</h2>
              <button className="icon-button" onClick={() => setShowPreferences(false)}><X size={20} /></button>
            </div>
            
            <div className="drawer-body" style={{ padding: '1.5rem', overflowY: 'auto' }}>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '2rem' }}>Control which notifications you receive and how they are delivered.</p>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                <div>
                  <h4 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem', borderBottom: '1px solid var(--gray-200)', paddingBottom: '0.5rem' }}>Attendance Alerts</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ fontSize: '0.875rem' }}>Late Login</span><input type="checkbox" defaultChecked /></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ fontSize: '0.875rem' }}>Early Logout</span><input type="checkbox" defaultChecked /></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ fontSize: '0.875rem' }}>Missing Punch</span><input type="checkbox" defaultChecked /></div>
                  </div>
                </div>
                
                <div>
                  <h4 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem', borderBottom: '1px solid var(--gray-200)', paddingBottom: '0.5rem' }}>Leave & WFH</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ fontSize: '0.875rem' }}>Request Approvals & Rejections</span><input type="checkbox" defaultChecked /></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ fontSize: '0.875rem' }}>Balance Warnings</span><input type="checkbox" defaultChecked /></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ fontSize: '0.875rem' }}>Upcoming WFH Reminders</span><input type="checkbox" defaultChecked /></div>
                  </div>
                </div>

                <div>
                  <h4 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem', borderBottom: '1px solid var(--gray-200)', paddingBottom: '0.5rem' }}>Payroll</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ fontSize: '0.875rem' }}>Payslip Available</span><input type="checkbox" defaultChecked /></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ fontSize: '0.875rem' }}>Salary Paid</span><input type="checkbox" defaultChecked /></div>
                  </div>
                </div>
                
                <div>
                  <h4 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem', borderBottom: '1px solid var(--gray-200)', paddingBottom: '0.5rem' }}>Delivery Channels</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ fontSize: '0.875rem' }}>In-App Notifications</span><input type="checkbox" defaultChecked disabled /></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ fontSize: '0.875rem' }}>Email Notifications</span><input type="checkbox" defaultChecked /></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ fontSize: '0.875rem' }}>Mobile Push Notifications</span><input type="checkbox" /></div>
                  </div>
                </div>
              </div>
              
              <div style={{ marginTop: '2rem' }}>
                <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => setShowPreferences(false)}>Save Preferences</button>
              </div>

            </div>
          </div>
        </div>
      )}

      <style>{`
        
        
        .drawer-overlay { position: fixed; inset: 0; background-color: rgba(0,0,0,0.4); z-index: 100; display: flex; justify-content: flex-end; }
        .drawer { background-color: var(--bg-surface); width: 100%; height: 100%; display: flex; flex-direction: column; box-shadow: var(--shadow-xl); animation: slideInRight 0.3s forwards; }
        .detail-drawer { max-width: 450px; }
        .drawer-header { padding: 1.5rem; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; }
        @media (max-width: 600px) {
          .drawer-overlay { align-items: flex-end; }
          .drawer { height: 90vh; border-top-left-radius: var(--radius-xl); border-top-right-radius: var(--radius-xl); animation: slideUp 0.3s forwards; }
          .detail-drawer { max-width: 100%; }
        }
        @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        .skeleton { background: linear-gradient(90deg, var(--gray-200) 25%, var(--gray-100) 50%, var(--gray-200) 75%); background-size: 200% 100%; animation: skeleton-loading 1.5s infinite; }
        @keyframes skeleton-loading { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
      `}</style>
    </div>
  );
};

export default Notifications;



