import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, Download, RefreshCw, Filter, Search, Eye,
  Activity, Users, Lock, AlertTriangle, CheckCircle2, X,
  FileText, Clock, ChevronRight, ChevronLeft, LayoutList, List
} from 'lucide-react';
import { exportService } from '../../services/export/exportService';
import { auditService } from '../../services/audit/auditService';
import { formatLastUpdated } from '../../utils/lastUpdated';
import { actorRole, inAuditRange, summarizeAuditLogs } from '../../services/audit/auditLogRules';
import { companyDateStr } from '../../utils/companyDate';

const AuditLogs: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<any[]>([]);
  const [selectedLog, setSelectedLog] = useState<any>(null);
  const [viewMode, setViewMode] = useState<'table'|'timeline'>('table');
  const [exportModal, setExportModal] = useState(false);
  const [toast, setToast] = useState('');
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [loadError, setLoadError] = useState('');
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Filters
  const [filters, setFilters] = useState({
    dateRange: 'This Month', user: 'All', role: 'All', module: 'All', 
    action: 'All', severity: 'All', result: 'All', search: ''
  });

  const fetchLogs = async () => {
    setLoading(true);
    setLoadError('');
    const { data, error } = await auditService.getAuditLogs();
    if (error) {
      console.error('[AUDIT LOG QUERY ERROR]', error);
      setLoadError(`Could not load audit events: ${(error as any).message || 'unknown error'}`);
    } else {
      // Display fields derived from the stored event (role = actor's role from the database)
      setLogs((data || []).map((l: any) => ({
        ...l,
        role: actorRole(l),
        user: l.employees ? `${l.employees.first_name} ${l.employees.last_name}` : 'System',
        timestamp: new Date(l.created_at).toLocaleString('en-GB'),
        severity: l.metadata?.severity || 'Info',
        result: l.metadata?.result || 'Success',
      })));
      setLastRefreshedAt(new Date());
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const handleRefresh = () => {
    fetchLogs();
  };

  const handleExport = (e: React.FormEvent) => {
    e.preventDefault();
    setExportModal(false);
    setToast('Generating...');
    setTimeout(() => {
      setToast('Audit report generated successfully');
      setTimeout(() => setToast(''), 3000);
    }, 1500);
  };

  const getSeverityBadge = (severity: string) => {
    switch(severity) {
      case 'Critical': return <span className="badge badge-danger">Critical</span>;
      case 'High': return <span className="badge badge-warning">High</span>;
      case 'Medium': return <span className="badge badge-primary" style={{ backgroundColor: 'var(--primary-100)', color: 'var(--primary-700)' }}>Medium</span>;
      case 'Low': return <span className="badge badge-gray">Low</span>;
      default: return <span className="badge badge-gray">{severity}</span>;
    }
  };

  const getResultBadge = (result: string) => {
    switch(result) {
      case 'Success': return <span className="badge badge-success">Success</span>;
      case 'Failed': return <span className="badge badge-danger">Failed</span>;
      case 'Blocked': return <span className="badge badge-warning">Blocked</span>;
      default: return <span className="badge">{result}</span>;
    }
  };

  // The date range applies to the table AND the summary counters
  const today = companyDateStr();
  const rangeLogs = logs.filter(log => inAuditRange(log, filters.dateRange, today));
  const summary = summarizeAuditLogs(rangeLogs, today);

  const filteredLogs = rangeLogs.filter(log => {
    if (filters.module !== 'All' && log.module !== filters.module.toUpperCase()) return false;
    if (filters.action !== 'All' && log.action !== filters.action.toUpperCase()) return false;
    if (filters.severity !== 'All' && log.severity !== filters.severity) return false;
    if (filters.result !== 'All' && log.result !== filters.result) return false;
    if (filters.role !== 'All' && log.role !== filters.role) return false;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const desc = log.description || '';
      const user = log.employees ? `${log.employees.first_name} ${log.employees.last_name}` : '';
      if (!desc.toLowerCase().includes(q) && 
          !user.toLowerCase().includes(q)) {
        return false;
      }
    }
    return true;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', position: 'relative' }}>
      
      {toast && (
        <div style={{ position: 'fixed', top: '24px', left: '50%', transform: 'translateX(-50%)', backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)', padding: '0.75rem 1.5rem', borderRadius: 'var(--radius-full)', zIndex: 1000, display: 'flex', alignItems: 'center', gap: '0.5rem', boxShadow: 'var(--shadow-lg)', animation: 'slideDown 0.3s forwards' }}>
          {toast.includes('successfully') ? <CheckCircle2 size={18} color="var(--success)" /> : <RefreshCw size={18} className="spin" />}
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="page-header" style={{ marginBottom: 0, flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="page-title">Audit Logs</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>Track important administrative, HR, payroll and security activities across WorkPulse HR.</p>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>Last updated: {formatLastUpdated(lastRefreshedAt)}</div>
          {loadError && <div role="alert" style={{ fontSize: '0.75rem', color: 'var(--danger)', marginTop: '0.25rem' }}>{loadError}{lastRefreshedAt ? ' — showing the last successfully loaded events.' : ''}</div>}
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={handleRefresh} className="btn btn-outline" style={{ fontSize: '0.875rem' }}><RefreshCw size={16}/> Refresh</button>
          <button onClick={() => exportService.excel(filteredLogs.map(l => ({ id: l.id.slice(0, 8), module: l.module, action: l.action, description: l.description, actor: l.employees ? `${l.employees.first_name} ${l.employees.last_name}` : 'System', role: l.role, date: new Date(l.created_at).toLocaleString() })), [{ header: 'ID', key: 'id', width: 10 }, { header: 'Module', key: 'module', width: 14 }, { header: 'Action', key: 'action', width: 24 }, { header: 'Description', key: 'description', width: 35 }, { header: 'Actor', key: 'actor', width: 22 }, { header: 'Role', key: 'role', width: 12 }, { header: 'Date', key: 'date', width: 22 }], `audit_logs_${new Date().toISOString().split('T')[0]}`)} className="btn btn-outline" style={{ fontSize: '0.875rem' }}><Download size={16}/> Export Logs</button>
        </div>
      </div>

      {/* Security Notice */}
      <div style={{ backgroundColor: 'var(--primary-50)', border: '1px solid var(--primary-200)', borderRadius: 'var(--radius-md)', padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <ShieldCheck size={20} color="var(--primary-600)" />
        <div>
          <span style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--primary-800)', display: 'block' }}>Audit history is read-only</span>
          <span style={{ fontSize: '0.75rem', color: 'var(--primary-700)' }}>Audit records are immutable and cannot be edited or deleted from this interface.</span>
        </div>
      </div>

      {/* KPI Cards */}
      {loading ? (
         <div className="skeleton" style={{ height: '100px', borderRadius: 'var(--radius-md)' }} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
          <div className="tracking-kpi-card">
            <div className="sc-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><FileText size={14}/> Total Events</div>
            <div className="sc-val">{summary.total}</div>
          </div>
          <div className="tracking-kpi-card">
            <div className="sc-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Clock size={14}/> Today</div>
            <div className="sc-val">{summary.today}</div>
          </div>
          <div className="tracking-kpi-card">
            <div className="sc-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><ShieldCheck size={14}/> Admin Actions</div>
            <div className="sc-val">{summary.admin}</div>
          </div>
          <div className="tracking-kpi-card">
            <div className="sc-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Users size={14}/> HR Actions</div>
            <div className="sc-val">{summary.hr}</div>
          </div>
          <div className="tracking-kpi-card">
            <div className="sc-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--warning)' }}><Lock size={14}/> Security Events</div>
            <div className="sc-val" style={{ color: 'var(--warning)' }}>{summary.security}</div>
          </div>
          <div className="tracking-kpi-card">
            <div className="sc-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--danger)' }}><AlertTriangle size={14}/> Critical Events</div>
            <div className="sc-val" style={{ color: 'var(--danger)' }}>{summary.critical}</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card" style={{ padding: '1rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', backgroundColor: 'var(--bg-surface-elevated)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderRight: '1px solid var(--border-color)', paddingRight: '1rem' }}>
          <Filter size={18} color="var(--gray-500)" />
          <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>Filters</span>
        </div>
        
        <select className="form-control" style={{ width: 'auto' }} value={filters.dateRange} onChange={e => setFilters({...filters, dateRange: e.target.value})}>
          <option>Today</option><option>Yesterday</option><option>Last 7 Days</option><option>Last 30 Days</option><option>This Month</option>
        </select>
        
        <select className="form-control" style={{ width: 'auto' }} value={filters.role} onChange={e => setFilters({...filters, role: e.target.value})}>
          <option value="All">All Roles</option><option>Admin</option><option>HR</option><option>Employee</option><option>System</option><option>Unknown</option>
        </select>

        <select className="form-control" style={{ width: 'auto' }} value={filters.module} onChange={e => setFilters({...filters, module: e.target.value})}>
          <option value="All">All Modules</option><option>Authentication</option><option>Attendance</option><option>Leave</option><option>Payroll</option><option>Security</option><option>Settings</option><option>Employees</option>
        </select>

        <select className="form-control" style={{ width: 'auto' }} value={filters.severity} onChange={e => setFilters({...filters, severity: e.target.value})}>
          <option value="All">All Severities</option><option>Critical</option><option>High</option><option>Medium</option><option>Low</option><option>Info</option>
        </select>

        <select className="form-control" style={{ width: 'auto' }} value={filters.result} onChange={e => setFilters({...filters, result: e.target.value})}>
          <option value="All">All Results</option><option>Success</option><option>Failed</option><option>Blocked</option>
        </select>

        <div style={{ position: 'relative', flex: 1, minWidth: '200px' }}>
          <Search size={14} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
          <input type="text" placeholder="Search logs..." className="form-control" style={{ paddingLeft: '2rem' }} value={filters.search} onChange={e => setFilters({...filters, search: e.target.value})} />
        </div>
        
        <button onClick={() => setFilters({dateRange: 'This Month', user: 'All', role: 'All', module: 'All', action: 'All', severity: 'All', result: 'All', search: ''})} className="btn btn-outline" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>Reset</button>
      </div>

      {/* Main Content Area */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '1rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 className="section-title" style={{ border: 'none', margin: 0 }}>Audit History</h3>
          <div style={{ display: 'flex', backgroundColor: 'var(--gray-100)', borderRadius: 'var(--radius-md)', padding: '2px' }}>
            <button onClick={() => setViewMode('table')} style={{ padding: '0.25rem 0.75rem', border: 'none', borderRadius: '4px', background: viewMode === 'table' ? 'var(--bg-surface)' : 'transparent', boxShadow: viewMode === 'table' ? 'var(--shadow-sm)' : 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.75rem', fontWeight: 600 }}>
              <LayoutList size={14}/> Table
            </button>
            <button onClick={() => setViewMode('timeline')} style={{ padding: '0.25rem 0.75rem', border: 'none', borderRadius: '4px', background: viewMode === 'timeline' ? 'var(--bg-surface)' : 'transparent', boxShadow: viewMode === 'timeline' ? 'var(--shadow-sm)' : 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.75rem', fontWeight: 600 }}>
              <List size={14}/> Timeline
            </button>
          </div>
        </div>

        {loading ? (
          <div className="skeleton" style={{ height: '400px' }} />
        ) : filteredLogs.length === 0 ? (
          <div style={{ padding: '4rem', textAlign: 'center' }}>
            <Search size={48} color="var(--gray-300)" style={{ margin: '0 auto 1rem auto' }}/>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              {loadError && logs.length === 0 ? 'Audit events could not be loaded' : logs.length === 0 ? 'No audit events recorded yet' : 'No audit events found'}
            </h3>
            <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
              {loadError && logs.length === 0 ? 'Use Refresh to try again.' : logs.length === 0 ? 'Events appear here as admins and employees use WorkPulse HR.' : 'Try changing your filters or search criteria.'}
            </p>
          </div>
        ) : viewMode === 'table' ? (
          <div className="table-container">
            <table className="table" style={{ width: '100%', fontSize: '0.875rem' }}>
              <thead><tr><th>Date & Time</th><th>User</th><th>Role</th><th>Action</th><th>Module</th><th>Severity</th><th>Result</th><th style={{ textAlign: 'right' }}>Action</th></tr></thead>
              <tbody>
                {filteredLogs.map(log => {
                  const { user, role, timestamp, severity, result } = log;

                  return (
                    <tr key={log.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{timestamp}</td>
                      <td style={{ fontWeight: 500 }}>{user}</td>
                      <td><span className="badge badge-gray">{role}</span></td>
                      <td style={{ fontWeight: 600, color: 'var(--gray-700)' }}>{log.action}</td>
                      <td>{log.module}</td>
                      <td>{getSeverityBadge(severity)}</td>
                      <td>{getResultBadge(result)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <button onClick={() => setSelectedLog(log)} className="btn btn-outline" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}>View Details</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            
            {/* Pagination Mock */}
            <div style={{ padding: '1rem', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Showing {filteredLogs.length} of {rangeLogs.length} events in {filters.dateRange.toLowerCase()}</div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="btn btn-outline" style={{ padding: '0.25rem 0.5rem' }} disabled><ChevronLeft size={16}/></button>
                <button className="btn btn-primary" style={{ padding: '0.25rem 0.75rem' }}>1</button>
                <button className="btn btn-outline" style={{ padding: '0.25rem 0.75rem' }}>2</button>
                <button className="btn btn-outline" style={{ padding: '0.25rem 0.75rem' }}>3</button>
                <button className="btn btn-outline" style={{ padding: '0.25rem 0.5rem' }}><ChevronRight size={16}/></button>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ padding: '2rem' }}>
            <div className="timeline">
              {filteredLogs.map((log, i) => (
                <div key={log.id} className="timeline-item">
                  <div className="timeline-marker" style={{ backgroundColor: log.result === 'Success' ? 'var(--success)' : log.result === 'Failed' ? 'var(--danger)' : 'var(--warning)' }}></div>
                  <div className="timeline-content card" style={{ padding: '1rem', cursor: 'pointer', marginBottom: '1.5rem' }} onClick={() => setSelectedLog(log)}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <div style={{ fontWeight: 600, fontSize: '0.9375rem' }}>{log.description}</div>
                      <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{log.timestamp}</div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.75rem' }}>
                      <span className="badge badge-gray">{log.module}</span>
                      <span style={{ display: 'flex', alignItems: 'center', color: 'var(--text-secondary)' }}><Users size={12} style={{ marginRight: '4px' }}/> {log.user} ({log.role})</span>
                      {getSeverityBadge(log.severity)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Export Modal */}
      {exportModal && (
        <div className="drawer-overlay" style={{ alignItems: 'center', zIndex: 120 }}>
          <div className="card" style={{ margin: 'auto', width: '100%', maxWidth: '450px', animation: 'slideUp 0.3s' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Export Audit Logs</h3>
              <button className="icon-button" onClick={() => setExportModal(false)}><X size={20}/></button>
            </div>
            
            <form onSubmit={handleExport} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div>
                <label className="form-label">Format</label>
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}><input type="radio" name="format" defaultChecked/> CSV</label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}><input type="radio" name="format"/> Excel</label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}><input type="radio" name="format"/> PDF</label>
                </div>
              </div>

              <div>
                <label className="form-label">Include Context Details</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.875rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><input type="checkbox" defaultChecked/> User Information</label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><input type="checkbox" defaultChecked/> Before/After Values</label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><input type="checkbox" defaultChecked/> IP & Device Info</label>
                </div>
              </div>

              <div style={{ backgroundColor: 'var(--primary-50)', padding: '1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--primary-200)' }}>
                <h4 style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--primary-800)', marginBottom: '0.5rem', textTransform: 'uppercase' }}>Active Filters</h4>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <span className="badge badge-gray" style={{ backgroundColor: 'var(--bg-surface-elevated)' }}>Date: {filters.dateRange}</span>
                  <span className="badge badge-gray" style={{ backgroundColor: 'var(--bg-surface-elevated)' }}>Module: {filters.module}</span>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--primary-700)', marginTop: '0.5rem' }}>The export will conceptually contain only the {filteredLogs.length} filtered records.</div>
              </div>

              <div style={{ display: 'flex', gap: '1rem' }}>
                <button type="button" onClick={() => setExportModal(false)} className="btn btn-outline" style={{ flex: 1 }}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>Generate Export</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Audit Detail Drawer */}
      {selectedLog && (
        <div className="drawer-overlay" onClick={() => setSelectedLog(null)}>
          <div className="drawer detail-drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header" style={{ alignItems: 'flex-start' }}>
              <div>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0, marginBottom: '0.25rem' }}>Audit Event Details</h2>
                <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{selectedLog.id}</span>
              </div>
              <button className="icon-button" onClick={() => setSelectedLog(null)}><X size={20} /></button>
            </div>
            
            <div className="drawer-body" style={{ padding: '1.5rem', overflowY: 'auto' }}>
              
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
                {getSeverityBadge(selectedLog.metadata?.severity || 'Info')}
                {getResultBadge(selectedLog.metadata?.result || 'Success')}
                <span className="badge badge-gray">{selectedLog.module}</span>
              </div>

              <div style={{ backgroundColor: 'var(--gray-50)', padding: '1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--gray-200)', marginBottom: '2rem' }}>
                <p style={{ margin: 0, fontSize: '1rem', fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.5 }}>{selectedLog.description}</p>
                {selectedLog.metadata?.reason && (
                  <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px dashed var(--gray-300)' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block' }}>REASON</span>
                    <span style={{ fontSize: '0.875rem', color: 'var(--gray-800)' }}>"{selectedLog.metadata.reason}"</span>
                  </div>
                )}
              </div>

              <h3 className="section-title">Event Context</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '2rem', fontSize: '0.875rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}><span className="info-label">Timestamp</span><span className="info-val">{new Date(selectedLog.created_at).toLocaleString('en-GB')}</span></div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}><span className="info-label">Action</span><span className="info-val" style={{ fontWeight: 700, color: 'var(--primary-700)' }}>{selectedLog.action}</span></div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}><span className="info-label">Performed By</span><span className="info-val">{selectedLog.employees ? `${selectedLog.employees.first_name} ${selectedLog.employees.last_name}` : 'System'} <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>({selectedLog.employees ? 'User' : 'System'})</span></span></div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}><span className="info-label">Target Module</span><span className="info-val">{selectedLog.module}</span></div>
                {selectedLog.entity_id && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', gridColumn: '1 / -1' }}><span className="info-label">Target Entity ID</span><span className="info-val">{selectedLog.entity_id}</span></div>
                )}
              </div>

              {(selectedLog.old_values || selectedLog.new_values) && (
                <>
                  <h3 className="section-title">Change Details</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '2rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <div style={{ flex: 1, backgroundColor: 'var(--danger-50)', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--danger-100)' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--danger)', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>BEFORE</span>
                        <span style={{ fontSize: '0.875rem', color: 'var(--danger-900)' }}>{JSON.stringify(selectedLog.old_values)}</span>
                      </div>
                      <ChevronRight color="var(--gray-400)" />
                      <div style={{ flex: 1, backgroundColor: 'var(--success-50)', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--success-100)' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--success)', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>AFTER</span>
                        <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--success-900)' }}>{JSON.stringify(selectedLog.new_values)}</span>
                      </div>
                    </div>
                  </div>
                </>
              )}

              <h3 className="section-title">Security & Session Details</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.75rem', fontSize: '0.875rem', backgroundColor: 'var(--gray-50)', padding: '1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--gray-200)', fontFamily: 'monospace' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-secondary)' }}>IP Address:</span><span style={{ fontWeight: 600 }}>{selectedLog.ip_address || 'N/A'}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-secondary)' }}>Device/Browser:</span><span style={{ fontWeight: 600 }}>{selectedLog.user_agent ? selectedLog.user_agent.substring(0, 30) + '...' : 'N/A'}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-secondary)' }}>Source:</span><span style={{ fontWeight: 600 }}>{selectedLog.source}</span></div>
              </div>

            </div>
          </div>
        </div>
      )}

      <style>{`
        
        
        
        
        
        
        
        
        
        
        .info-label { color: var(--gray-500); font-size: 0.75rem; text-transform: uppercase; font-weight: 600; }
        .info-val { font-weight: 500; color: var(--gray-900); }
        
        .timeline { border-left: 2px solid var(--gray-200); margin-left: 1rem; padding-left: 1.5rem; position: relative; }
        .timeline-item { position: relative; }
        .timeline-marker { position: absolute; left: -1.5rem; top: 1.25rem; width: 12px; height: 12px; border-radius: 50%; transform: translateX(-5px); border: 2px solid white; box-shadow: 0 0 0 1px var(--gray-200); }
        .timeline-content { transition: transform 0.2s, box-shadow 0.2s; }
        .timeline-content:hover { transform: translateY(-2px); box-shadow: var(--shadow-md); }

        .drawer-overlay { position: fixed; inset: 0; background-color: rgba(0,0,0,0.4); z-index: 100; display: flex; justify-content: flex-end; }
        .drawer { background-color: var(--bg-surface); width: 100%; height: 100%; display: flex; flex-direction: column; box-shadow: var(--shadow-xl); animation: slideInRight 0.3s forwards; }
        .detail-drawer { max-width: 500px; }
        .drawer-header { padding: 1.5rem; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; }
        
        @media (max-width: 600px) {
          .drawer-overlay { align-items: flex-end; }
          .drawer { height: 90vh; border-top-left-radius: var(--radius-xl); border-top-right-radius: var(--radius-xl); animation: slideUp 0.3s forwards; }
          .detail-drawer { max-width: 100%; }
        }
        
        @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes slideDown { from { transform: translate(-50%, -100%); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }
        .skeleton { background: linear-gradient(90deg, var(--gray-200) 25%, var(--gray-100) 50%, var(--gray-200) 75%); background-size: 200% 100%; animation: skeleton-loading 1.5s infinite; }
        @keyframes skeleton-loading { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};

export default AuditLogs;



