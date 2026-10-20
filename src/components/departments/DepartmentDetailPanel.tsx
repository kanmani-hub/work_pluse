import React, { useEffect } from 'react';
import { X, AlertTriangle, RefreshCw } from 'lucide-react';
import { toDepartmentDetail, type DepartmentEmployeeRow } from '../../services/department/departmentDetailRules';

export type DepartmentEmployeesState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; rows: DepartmentEmployeeRow[] };

interface Props {
  /** The department row from the Departments list (departments.* columns). */
  department: any;
  employees: DepartmentEmployeesState;
  onClose: () => void;
  onRetry: () => void;
  onOpenEmployees: () => void;
}

const muted: React.CSSProperties = { color: 'var(--text-secondary)', fontStyle: 'italic' };

/**
 * Admin → Departments → View Details. Every value shown is plain text from toDepartmentDetail /
 * toDepartmentEmployeeRows (never a raw object), with explicit loading, error and empty states.
 * Uses the drawer styles defined on the Departments page.
 */
const DepartmentDetailPanel: React.FC<Props> = ({ department, employees, onClose, onRetry, onOpenEmployees }) => {
  const d = toDepartmentDetail(department);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer wide-drawer department-detail" role="dialog" aria-modal="true" aria-labelledby="department-detail-title" onClick={e => e.stopPropagation()}>
        <div className="drawer-header" style={{ paddingBottom: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', width: '100%', gap: '1rem' }}>
            <div style={{ minWidth: 0 }}>
              <h2 id="department-detail-title" style={{ fontSize: '1.5rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', overflowWrap: 'anywhere' }}>
                {d.name}
                {d.code
                  ? <span className="badge badge-gray" style={{ fontFamily: 'monospace' }} data-testid="department-code">{d.code}</span>
                  : <span className="badge badge-gray" style={{ fontWeight: 400 }} data-testid="department-code">No code</span>}
              </h2>
              <div style={{ display: 'flex', gap: '1rem', fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                <span data-testid="department-manager">Manager: {d.manager ? <strong>{d.manager}</strong> : <span style={muted}>No manager assigned</span>}</span>
                <span>Created: {d.created ? <strong>{d.created}</strong> : <span style={muted}>Not recorded</span>}</span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexShrink: 0 }}>
              <span className={`badge ${d.statusLabel === 'Active' ? 'badge-success' : 'badge-gray'}`}>{d.statusLabel}</span>
              <button className="icon-button" onClick={onClose} aria-label="Close"><X size={20} /></button>
            </div>
          </div>
        </div>

        <div className="drawer-body" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          <div className="card" style={{ padding: '1rem' }}>
            <h3 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--gray-700)', marginBottom: '0.5rem' }}>Description</h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{d.description ?? 'No description provided.'}</p>
          </div>

          <div>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
              Employees in Department
              {employees.status === 'ready' && <span className="badge badge-primary" data-testid="department-employee-count">{employees.rows.length} Total</span>}
            </h3>

            {employees.status === 'loading' && (
              <div role="status" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)', border: '1px dashed var(--gray-300)', borderRadius: 'var(--radius-md)' }}>
                Loading employees…
              </div>
            )}

            {employees.status === 'error' && (
              <div role="alert" style={{ padding: '1rem', color: 'var(--danger)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column', gap: '0.75rem', alignItems: 'flex-start' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><AlertTriangle size={16} aria-hidden={true} /> Employees could not be loaded: {employees.message}</span>
                <button type="button" onClick={onRetry} className="btn btn-outline" style={{ fontSize: '0.8125rem' }}><RefreshCw size={14} aria-hidden={true} /> Retry</button>
              </div>
            )}

            {employees.status === 'ready' && employees.rows.length === 0 && (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)', border: '1px dashed var(--gray-300)', borderRadius: 'var(--radius-md)' }}>
                No employees currently assigned to this department.
              </div>
            )}

            {employees.status === 'ready' && employees.rows.length > 0 && (
              <div className="table-container" style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)' }}>
                <table className="table department-employees" style={{ width: '100%', minWidth: 0 }}>
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Designation</th>
                      <th>Office</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employees.rows.map(emp => (
                      <tr key={emp.key}>
                        <td>
                          <div style={{ fontWeight: 500, overflowWrap: 'anywhere' }}>{emp.name}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{emp.employeeCode ?? '—'}</div>
                        </td>
                        <td style={{ fontSize: '0.875rem' }}>{emp.designation ?? '—'}</td>
                        <td style={{ fontSize: '0.875rem' }}>{emp.office ?? '—'}</td>
                        <td><span className={`badge ${emp.active ? 'badge-success' : 'badge-gray'}`}>{emp.statusLabel}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ marginTop: '1rem', textAlign: 'center' }}>
              <button onClick={onOpenEmployees} className="btn btn-outline" style={{ fontSize: '0.875rem' }}>Manage in Employee Directory</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DepartmentDetailPanel;
