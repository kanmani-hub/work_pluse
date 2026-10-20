import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  ShieldCheck, Download, RefreshCw, Filter, Search, Eye,
  Activity, Users, Lock, AlertTriangle, CheckCircle2, X,
  FileText, Clock, ChevronRight, ChevronLeft, LayoutList, List,
  ChevronDown, RotateCcw, FileSpreadsheet
} from 'lucide-react';
import { exportService } from '../../services/export/exportService';
import { auditService } from '../../services/audit/auditService';
import { formatLastUpdated } from '../../utils/lastUpdated';
import { 
  actorRole, 
  inAuditRange, 
  summarizeAuditLogs, 
  auditCardRows, 
  type AuditCard,
  filterAuditLogs,
  DEFAULT_AUDIT_FILTERS,
  AUDIT_EXPORT_COLUMNS,
  formatAuditLogForExport,
  getAuditExportFilename,
  type AuditFilters
} from '../../services/audit/auditLogRules';
import RecordsModal from '../../components/common/RecordsModal';
import { clickableCardProps } from '../../services/common/cardDetails';
import { companyDateStr } from '../../utils/companyDate';

function renderPaginationButtons(
  currentPage: number,
  totalPages: number,
  setPage: (p: number) => void
) {
  if (totalPages <= 1) return null;
  const pages: (number | string)[] = [];

  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (currentPage > 3) pages.push('...');
    const start = Math.max(2, currentPage - 1);
    const end = Math.min(totalPages - 1, currentPage + 1);
    for (let i = start; i <= end; i++) pages.push(i);
    if (currentPage < totalPages - 2) pages.push('...');
    pages.push(totalPages);
  }

  return pages.map((p, idx) => {
    if (p === '...') {
      return (
        <span key={`ellipsis-${idx}`} style={{ padding: '0.25rem 0.5rem', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          …
        </span>
      );
    }
    const isCurrent = p === currentPage;
    return (
      <button
        key={`page-${p}`}
        className={`btn ${isCurrent ? 'btn-primary' : 'btn-outline'}`}
        style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem', minWidth: '32px' }}
        onClick={() => setPage(Number(p))}
        aria-current={isCurrent ? 'page' : undefined}
      >
        {p}
      </button>
    );
  });
}

const AuditLogs: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<any[]>([]);
  const [openCard, setOpenCard] = useState<AuditCard | null>(null);
  const [selectedLog, setSelectedLog] = useState<any>(null);
  const [viewMode, setViewMode] = useState<'table' | 'timeline'>('table');
  const [toast, setToast] = useState('');
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [loadError, setLoadError] = useState('');
  
  // Export Menu State
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const exportDropdownRef = useRef<HTMLDivElement>(null);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Filters
  const [filters, setFilters] = useState<AuditFilters>({ ...DEFAULT_AUDIT_FILTERS });

  const fetchLogs = async () => {
    setLoading(true);
    setLoadError('');
    // Use getAllAuditLogs to retrieve all audit history without silent 1000-row clipping
    const { data, error } = await auditService.getAllAuditLogs();
    if (error) {
      console.error('[AUDIT LOG QUERY ERROR]', error);
      setLoadError(`Could not load audit events: ${(error as any).message || 'unknown error'}`);
    } else {
      // Display fields derived from the stored event (role = actor's role from the database)
      setLogs((data || []).map((l: any) => ({
        ...l,
        role: actorRole(l),
        user: l.employees ? `${l.employees.first_name || ''} ${l.employees.last_name || ''}`.trim() : 'System',
        timestamp: l.created_at ? new Date(l.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—',
        severity: l.metadata?.severity || l.severity || 'Info',
        result: l.metadata?.result || l.result || 'Success',
      })));
      setLastRefreshedAt(new Date());
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  // Close export menu on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(event.target as Node)) {
        setExportMenuOpen(false);
      }
    };

    if (exportMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [exportMenuOpen]);

  // Keyboard navigation for export menu
  const handleExportMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setExportMenuOpen(false);
      const btn = document.getElementById('audit-export-dropdown-btn');
      btn?.focus();
    }
  };

  const handleRefresh = async () => {
    await fetchLogs();
  };

  const handleReset = () => {
    setFilters({ ...DEFAULT_AUDIT_FILTERS });
    setCurrentPage(1);
  };

  // Distinct employees available in the loaded logs for the employee filter
  const employeeFilterOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const log of logs) {
      if (log.employees?.employee_code) {
        const name = `${log.employees.first_name || ''} ${log.employees.last_name || ''}`.trim();
        map.set(log.employees.employee_code, `${name} (${log.employees.employee_code})`);
      } else if (log.actor_employee_id) {
        map.set(log.actor_employee_id, log.user || log.actor_employee_id);
      }
    }
    return Array.from(map.entries()).map(([value, label]) => ({ value, label }));
  }, [logs]);

  const today = companyDateStr();

  // 1. Date-range filtered logs (governs the summary counters)
  const rangeLogs = useMemo(() => {
    return logs.filter(log => inAuditRange(log, filters.dateRange, today));
  }, [logs, filters.dateRange, today]);

  // 2. Summary KPI counts for date-filtered logs
  const summary = useMemo(() => {
    return summarizeAuditLogs(rangeLogs, today);
  }, [rangeLogs, today]);

  // 3. Fully filtered logs (date range + all dropdowns + trimmed search)
  const filteredLogs = useMemo(() => {
    return filterAuditLogs(rangeLogs, filters, today);
  }, [rangeLogs, filters, today]);

  // 4. Pagination calculations
  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / pageSize));
  const effectivePage = Math.min(currentPage, totalPages);
  const startIndex = (effectivePage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, filteredLogs.length);
  const paginatedLogs = filteredLogs.slice(startIndex, endIndex);

  // Handle Export in Excel, PDF, or CSV format
  const handleExport = async (format: 'xlsx' | 'pdf' | 'csv') => {
    setExportMenuOpen(false);

    if (filteredLogs.length === 0) {
      setToast('No audit records available to export for the current filters');
      setTimeout(() => setToast(''), 3500);
      return;
    }

    try {
      setExporting(true);
      setToast(`Preparing ${format.toUpperCase()} export...`);

      const exportRows = filteredLogs.map(formatAuditLogForExport);
      const filename = getAuditExportFilename(format, today);

      if (format === 'xlsx') {
        await exportService.excel(exportRows, AUDIT_EXPORT_COLUMNS, filename, 'AuditLogs');
      } else if (format === 'pdf') {
        const searchSummary = filters.search.trim() ? ` | Search: "${filters.search.trim()}"` : '';
        const subtitle = `Filter: Date: ${filters.dateRange} | Module: ${filters.module} | Severity: ${filters.severity} | Records: ${filteredLogs.length}${searchSummary}`;
        await exportService.pdf(exportRows, AUDIT_EXPORT_COLUMNS, 'WorkPulse HR — Audit Logs', filename, subtitle);
      } else if (format === 'csv') {
        await exportService.csv(exportRows, AUDIT_EXPORT_COLUMNS, filename);
      }

      setToast(`Exported ${filename} successfully`);
      setTimeout(() => setToast(''), 3500);
    } catch (err: any) {
      console.error('[AUDIT EXPORT ERROR]', err);
      setToast(`Export failed: ${err?.message || 'Unknown error'}`);
      setTimeout(() => setToast(''), 5000);
    } finally {
      setExporting(false);
    }
  };

  const getSeverityBadge = (severity: string) => {
    const s = (severity || '').toLowerCase();
    switch(s) {
      case 'critical': return <span className="badge badge-danger">Critical</span>;
      case 'high': return <span className="badge badge-warning">High</span>;
      case 'medium': return <span className="badge badge-primary" style={{ backgroundColor: 'var(--primary-100)', color: 'var(--primary-700)' }}>Medium</span>;
      case 'low': return <span className="badge badge-gray">Low</span>;
      default: return <span className="badge badge-gray">{severity || 'Info'}</span>;
    }
  };

  const getResultBadge = (result: string) => {
    const r = (result || '').toLowerCase();
    switch(r) {
      case 'success': return <span className="badge badge-success">Success</span>;
      case 'failed':
      case 'failure': return <span className="badge badge-danger">Failed</span>;
      case 'blocked': return <span className="badge badge-warning">Blocked</span>;
      default: return <span className="badge">{result || 'Success'}</span>;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', position: 'relative' }}>
      
      {toast && (
        <div style={{ position: 'fixed', top: '24px', left: '50%', transform: 'translateX(-50%)', backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)', padding: '0.75rem 1.5rem', borderRadius: 'var(--radius-full)', zIndex: 1000, display: 'flex', alignItems: 'center', gap: '0.5rem', boxShadow: 'var(--shadow-lg)', animation: 'slideDown 0.3s forwards' }}>
          {toast.includes('successfully') ? <CheckCircle2 size={18} color="var(--success)" /> : toast.includes('failed') || toast.includes('No audit records') ? <AlertTriangle size={18} color="var(--danger)" /> : <RefreshCw size={18} className="spin" />}
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
          <button onClick={handleRefresh} disabled={loading} className="btn btn-outline" style={{ fontSize: '0.875rem' }}>
            <RefreshCw size={16} className={loading ? 'spin' : ''}/> Refresh
          </button>

          {/* Export Dropdown Menu (Excel, PDF, CSV) */}
          <div style={{ position: 'relative' }} ref={exportDropdownRef}>
            <button 
              id="audit-export-dropdown-btn"
              onClick={() => setExportMenuOpen(!exportMenuOpen)} 
              disabled={exporting || loading}
              className="btn btn-outline" 
              style={{ fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              aria-expanded={exportMenuOpen}
              aria-haspopup="menu"
            >
              {exporting ? <RefreshCw size={16} className="spin" /> : <Download size={16} />}
              <span>Export Logs</span>
              <ChevronDown size={14} style={{ transform: exportMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
            </button>

            {exportMenuOpen && (
              <div 
                role="menu"
                aria-labelledby="audit-export-dropdown-btn"
                style={{
                  position: 'absolute',
                  right: 0,
                  top: 'calc(100% + 6px)',
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)',
                  boxShadow: 'var(--shadow-lg)',
                  minWidth: '220px',
                  zIndex: 100,
                  overflow: 'hidden',
                  animation: 'slideDown 0.15s ease-out'
                }}
                onKeyDown={handleExportMenuKeyDown}
              >
                <div style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--border-color)', fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>
                  Export {filteredLogs.length} matching {filteredLogs.length === 1 ? 'record' : 'records'}
                </div>
                <button
                  role="menuitem"
                  tabIndex={0}
                  onClick={() => handleExport('xlsx')}
                  style={{
                    width: '100%',
                    padding: '0.625rem 1rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    border: 'none',
                    background: 'none',
                    color: 'var(--text-primary)',
                    fontSize: '0.875rem',
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'background-color 0.15s'
                  }}
                  className="dropdown-menu-item"
                >
                  <FileSpreadsheet size={16} color="var(--success)" />
                  <div>
                    <div style={{ fontWeight: 500 }}>Export as Excel (.xlsx)</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Spreadsheet with column widths</div>
                  </div>
                </button>

                <button
                  role="menuitem"
                  tabIndex={0}
                  onClick={() => handleExport('pdf')}
                  style={{
                    width: '100%',
                    padding: '0.625rem 1rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    border: 'none',
                    background: 'none',
                    color: 'var(--text-primary)',
                    fontSize: '0.875rem',
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'background-color 0.15s'
                  }}
                  className="dropdown-menu-item"
                >
                  <FileText size={16} color="var(--danger)" />
                  <div>
                    <div style={{ fontWeight: 500 }}>Export as PDF (.pdf)</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Document with page numbers</div>
                  </div>
                </button>

                <button
                  role="menuitem"
                  tabIndex={0}
                  onClick={() => handleExport('csv')}
                  style={{
                    width: '100%',
                    padding: '0.625rem 1rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    border: 'none',
                    background: 'none',
                    color: 'var(--text-primary)',
                    fontSize: '0.875rem',
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'background-color 0.15s'
                  }}
                  className="dropdown-menu-item"
                >
                  <FileText size={16} color="var(--primary)" />
                  <div>
                    <div style={{ fontWeight: 500 }}>Export as CSV (.csv)</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>UTF-8 format with quote escaping</div>
                  </div>
                </button>
              </div>
            )}
          </div>
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
          <div className="tracking-kpi-card" {...clickableCardProps('Total Events', () => setOpenCard('total'))}>
            <div className="sc-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><FileText size={14}/> Total Events</div>
            <div className="sc-val">{summary.total}</div>
          </div>
          <div className="tracking-kpi-card" {...clickableCardProps('Today', () => setOpenCard('today'))}>
            <div className="sc-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Clock size={14}/> Today</div>
            <div className="sc-val">{summary.today}</div>
          </div>
          <div className="tracking-kpi-card" {...clickableCardProps('Admin Actions', () => setOpenCard('admin'))}>
            <div className="sc-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><ShieldCheck size={14}/> Admin Actions</div>
            <div className="sc-val">{summary.admin}</div>
          </div>
          <div className="tracking-kpi-card" {...clickableCardProps('HR Actions', () => setOpenCard('hr'))}>
            <div className="sc-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Users size={14}/> HR Actions</div>
            <div className="sc-val">{summary.hr}</div>
          </div>
          <div className="tracking-kpi-card" {...clickableCardProps('Security Events', () => setOpenCard('security'))}>
            <div className="sc-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--warning)' }}><Lock size={14}/> Security Events</div>
            <div className="sc-val" style={{ color: 'var(--warning)' }}>{summary.security}</div>
          </div>
          <div className="tracking-kpi-card" {...clickableCardProps('Critical Events', () => setOpenCard('critical'))}>
            <div className="sc-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--danger)' }}><AlertTriangle size={14}/> Critical Events</div>
            <div className="sc-val" style={{ color: 'var(--danger)' }}>{summary.critical}</div>
          </div>
        </div>
      )}

      {/* Filters Bar */}
      <div className="card" style={{ padding: '1rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', backgroundColor: 'var(--bg-surface-elevated)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderRight: '1px solid var(--border-color)', paddingRight: '0.75rem' }}>
          <Filter size={18} color="var(--gray-500)" />
          <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>Filters</span>
        </div>
        
        {/* Date Range Filter */}
        <select 
          className="form-control" 
          style={{ width: 'auto' }} 
          value={filters.dateRange} 
          onChange={e => {
            setFilters({ ...filters, dateRange: e.target.value });
            setCurrentPage(1);
          }} 
          aria-label="Date range"
        >
          <option>Today</option>
          <option>Yesterday</option>
          <option>Last 7 Days</option>
          <option>Last 30 Days</option>
          <option>This Month</option>
          <option value="All Time">All Time</option>
        </select>
        
        {/* Employee Filter */}
        <select
          className="form-control"
          style={{ width: 'auto' }}
          value={filters.employee}
          onChange={e => {
            setFilters({ ...filters, employee: e.target.value });
            setCurrentPage(1);
          }}
          aria-label="Filter by employee"
        >
          <option value="All">All Employees</option>
          <option value="System">System</option>
          {employeeFilterOptions.map(emp => (
            <option key={emp.value} value={emp.value}>{emp.label}</option>
          ))}
        </select>

        {/* Role Filter */}
        <select 
          className="form-control" 
          style={{ width: 'auto' }} 
          value={filters.role} 
          onChange={e => {
            setFilters({ ...filters, role: e.target.value });
            setCurrentPage(1);
          }} 
          aria-label="Role"
        >
          <option value="All">All Roles</option>
          <option>Admin</option>
          <option>HR</option>
          <option>Employee</option>
          <option>System</option>
          <option>Unknown</option>
        </select>

        {/* Module Filter */}
        <select 
          className="form-control" 
          style={{ width: 'auto' }} 
          value={filters.module} 
          onChange={e => {
            setFilters({ ...filters, module: e.target.value });
            setCurrentPage(1);
          }} 
          aria-label="Module"
        >
          <option value="All">All Modules</option>
          <option value="AUTH">Authentication</option>
          <option value="ATTENDANCE">Attendance</option>
          <option value="LEAVE">Leave</option>
          <option value="PAYROLL">Payroll</option>
          <option value="SECURITY">Security</option>
          <option value="SETTINGS">Settings</option>
          <option value="EMPLOYEE">Employees</option>
          <option value="REPORTS">Reports</option>
        </select>

        {/* Severity Filter */}
        <select 
          className="form-control" 
          style={{ width: 'auto' }} 
          value={filters.severity} 
          onChange={e => {
            setFilters({ ...filters, severity: e.target.value });
            setCurrentPage(1);
          }} 
          aria-label="Severity"
        >
          <option value="All">All Severities</option>
          <option>Critical</option>
          <option>High</option>
          <option>Medium</option>
          <option>Low</option>
          <option>Info</option>
        </select>

        {/* Result Filter */}
        <select 
          className="form-control" 
          style={{ width: 'auto' }} 
          value={filters.result} 
          onChange={e => {
            setFilters({ ...filters, result: e.target.value });
            setCurrentPage(1);
          }} 
          aria-label="Result"
        >
          <option value="All">All Results</option>
          <option>Success</option>
          <option>Failed</option>
          <option>Blocked</option>
        </select>

        {/* Search Query Input */}
        <div style={{ position: 'relative', flex: 1, minWidth: '220px' }}>
          <Search size={14} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
          <input 
            type="text" 
            placeholder="Search by employee, action, module, ID, actor..." 
            className="form-control" 
            style={{ paddingLeft: '2rem', paddingRight: filters.search ? '2rem' : '0.75rem' }} 
            value={filters.search} 
            onChange={e => {
              setFilters({ ...filters, search: e.target.value });
              setCurrentPage(1);
            }} 
            aria-label="Search logs" 
          />
          {filters.search && (
            <button
              onClick={() => {
                setFilters({ ...filters, search: '' });
                setCurrentPage(1);
              }}
              style={{
                position: 'absolute',
                right: '0.5rem',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-secondary)',
                padding: '2px',
                display: 'flex',
                alignItems: 'center'
              }}
              aria-label="Clear search"
              title="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>
        
        {/* Reset Button */}
        <button 
          onClick={handleReset} 
          className="btn btn-outline" 
          style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
          title="Reset all filters to defaults"
        >
          <RotateCcw size={13} />
          <span>Reset</span>
        </button>
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
              {loadError && logs.length === 0 
                ? 'Audit events could not be loaded' 
                : logs.length === 0 
                ? 'No audit events recorded yet' 
                : 'No matching audit events found'}
            </h3>
            <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem', maxWidth: '420px', margin: '0.5rem auto 1.5rem auto' }}>
              {loadError && logs.length === 0 
                ? 'Use Refresh to try connecting again.' 
                : logs.length === 0 
                ? 'Events appear here automatically as administrators and employees use WorkPulse HR.' 
                : filters.search.trim() 
                ? `No records matched "${filters.search.trim()}" with the current filters. Try adjusting your query or filters.` 
                : 'Try changing your filter selections to see more audit events.'}
            </p>
            {(filters.search || filters.module !== 'All' || filters.severity !== 'All' || filters.result !== 'All' || filters.role !== 'All' || filters.employee !== 'All' || filters.dateRange !== 'This Month') && (
              <button onClick={handleReset} className="btn btn-outline" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}>
                <RotateCcw size={14} /> Clear all filters
              </button>
            )}
          </div>
        ) : viewMode === 'table' ? (
          <div className="table-container">
            <table className="table" style={{ width: '100%', fontSize: '0.875rem' }}>
              <thead>
                <tr>
                  <th>Date & Time</th>
                  <th>Actor / User</th>
                  <th>Role</th>
                  <th>Action</th>
                  <th>Module</th>
                  <th>Severity</th>
                  <th>Result</th>
                  <th style={{ textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {paginatedLogs.map(log => {
                  const { user, role, timestamp, severity, result } = log;

                  return (
                    <tr key={log.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{timestamp}</td>
                      <td style={{ fontWeight: 500 }}>
                        <div>{user}</div>
                        {log.employees?.employee_code && (
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                            {log.employees.employee_code}
                          </span>
                        )}
                      </td>
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
            
            {/* Real Pagination Bar */}
            <div style={{ padding: '1rem', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
              <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <span>
                  Showing {filteredLogs.length > 0 ? startIndex + 1 : 0}–{endIndex} of {filteredLogs.length} events
                  {filteredLogs.length !== rangeLogs.length && (
                    <span style={{ opacity: 0.8 }}> (filtered from {rangeLogs.length} in {filters.dateRange.toLowerCase()})</span>
                  )}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <label htmlFor="audit-page-size" style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Per page:</label>
                  <select
                    id="audit-page-size"
                    className="form-control"
                    style={{ width: 'auto', padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                    value={pageSize}
                    onChange={e => {
                      setPageSize(Number(e.target.value));
                      setCurrentPage(1);
                    }}
                  >
                    <option value={10}>10</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <button 
                  className="btn btn-outline" 
                  style={{ padding: '0.25rem 0.5rem' }} 
                  disabled={effectivePage <= 1} 
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  aria-label="Previous page"
                >
                  <ChevronLeft size={16}/>
                </button>
                
                {renderPaginationButtons(effectivePage, totalPages, setCurrentPage)}

                <button 
                  className="btn btn-outline" 
                  style={{ padding: '0.25rem 0.5rem' }} 
                  disabled={effectivePage >= totalPages} 
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  aria-label="Next page"
                >
                  <ChevronRight size={16}/>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ padding: '2rem' }}>
            <div className="timeline">
              {paginatedLogs.map((log) => (
                <div key={log.id} className="timeline-item">
                  <div className="timeline-marker" style={{ backgroundColor: log.result === 'Success' ? 'var(--success)' : log.result === 'Failed' ? 'var(--danger)' : 'var(--warning)' }}></div>
                  <div className="timeline-content card" style={{ padding: '1rem', cursor: 'pointer', marginBottom: '1.5rem' }} onClick={() => setSelectedLog(log)}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <div style={{ fontWeight: 600, fontSize: '0.9375rem' }}>{log.description}</div>
                      <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{log.timestamp}</div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <span className="badge badge-gray">{log.module}</span>
                      <span style={{ display: 'flex', alignItems: 'center', color: 'var(--text-secondary)' }}><Users size={12} style={{ marginRight: '4px' }}/> {log.user} ({log.role})</span>
                      {log.employees?.employee_code && (
                        <span style={{ color: 'var(--text-secondary)', fontFamily: 'monospace' }}>[{log.employees.employee_code}]</span>
                      )}
                      {getSeverityBadge(log.severity)}
                      {getResultBadge(log.result)}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Timeline Pagination Bar */}
            <div style={{ padding: '1rem 0', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
              <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                Showing {filteredLogs.length > 0 ? startIndex + 1 : 0}–{endIndex} of {filteredLogs.length} events
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <button 
                  className="btn btn-outline" 
                  style={{ padding: '0.25rem 0.5rem' }} 
                  disabled={effectivePage <= 1} 
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  aria-label="Previous page"
                >
                  <ChevronLeft size={16}/>
                </button>
                {renderPaginationButtons(effectivePage, totalPages, setCurrentPage)}
                <button 
                  className="btn btn-outline" 
                  style={{ padding: '0.25rem 0.5rem' }} 
                  disabled={effectivePage >= totalPages} 
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  aria-label="Next page"
                >
                  <ChevronRight size={16}/>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Audit Detail Drawer */}
      {selectedLog && (
        <div className="drawer-overlay" onClick={() => setSelectedLog(null)}>
          <div className="drawer detail-drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header" style={{ alignItems: 'flex-start' }}>
              <div>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0, marginBottom: '0.25rem' }}>Audit Event Details</h2>
                <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{selectedLog.id}</span>
              </div>
              <button className="icon-button" onClick={() => setSelectedLog(null)} aria-label="Close"><X size={20} /></button>
            </div>
            
            <div className="drawer-body" style={{ padding: '1.5rem', overflowY: 'auto' }}>
              
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
                {getSeverityBadge(selectedLog.metadata?.severity || selectedLog.severity || 'Info')}
                {getResultBadge(selectedLog.metadata?.result || selectedLog.result || 'Success')}
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}><span className="info-label">Timestamp</span><span className="info-val">{new Date(selectedLog.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</span></div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}><span className="info-label">Action</span><span className="info-val" style={{ fontWeight: 700, color: 'var(--primary-700)' }}>{selectedLog.action}</span></div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <span className="info-label">Performed By</span>
                  <span className="info-val">
                    {selectedLog.employees ? `${selectedLog.employees.first_name || ''} ${selectedLog.employees.last_name || ''}`.trim() : 'System'}
                    {selectedLog.employees?.employee_code && ` (${selectedLog.employees.employee_code})`}
                  </span>
                </div>
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
        
        .dropdown-menu-item:hover, .dropdown-menu-item:focus {
          background-color: var(--bg-surface-elevated) !important;
          outline: none;
        }

        @media (max-width: 600px) {
          .drawer-overlay { align-items: flex-end; }
          .drawer { height: 90vh; border-top-left-radius: var(--radius-xl); border-top-right-radius: var(--radius-xl); animation: slideUp 0.3s forwards; }
          .detail-drawer { max-width: 100%; }
        }
        
        @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes slideDown { from { transform: translateY(-6px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        .skeleton { background: linear-gradient(90deg, var(--gray-200) 25%, var(--gray-100) 50%, var(--gray-200) 75%); background-size: 200% 100%; animation: skeleton-loading 1.5s infinite; }
        @keyframes skeleton-loading { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>

      {openCard && (() => {
        const titles: Record<AuditCard, [string, string]> = {
          total: ['Total Events', 'Every audit event in the selected date range.'],
          today: ['Events Today', 'Events recorded on today’s company date (Asia/Kolkata).'],
          admin: ['Admin Actions', 'Events whose actor has the ADMIN role.'],
          hr: ['HR Actions', 'Events whose actor has the HR role.'],
          security: ['Security Events', 'Events in the SECURITY module.'],
          critical: ['Critical Events', 'Events whose severity is Critical.'],
        };
        const rows = auditCardRows(rangeLogs, today, openCard);
        return <RecordsModal open title={titles[openCard][0]} subtitle={`Date range: ${filters.dateRange}`} total={rows.length} totalLabel="Events"
          columns={[{ key: 'when', label: 'Date & Time' }, { key: 'actor', label: 'Actor' }, { key: 'role', label: 'Role' }, { key: 'module', label: 'Module' }, { key: 'action', label: 'Action' }, { key: 'description', label: 'Description' }, { key: 'severity', label: 'Severity' }, { key: 'result', label: 'Result' }]}
          rows={rows} loading={loading} error={loadError || null} emptyMessage="No matching audit events in this range."
          explanation={[titles[openCard][1], 'Uses the same date range as the counters. Audit history is read-only; the table filters and Export are unchanged.']} onClose={() => setOpenCard(null)} />;
      })()}
    </div>
  );
};

export default AuditLogs;
