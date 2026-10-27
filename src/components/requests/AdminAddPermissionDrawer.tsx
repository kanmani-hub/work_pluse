import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { permissionService } from '../../services/permission/permissionService';
import { shiftService } from '../../services/shifts/shiftService';
import { companyDateStr } from '../../utils/companyDate';

/**
 * Admin → Permissions → Add Permission: saves a real permission for an employee (replaces the old
 * drawer that showed "Permission added successfully" without saving). Overlaps with the employee's
 * active permissions on that day are refused. Success only after the database confirmed the save.
 */
interface Props { onClose: () => void; onSaved: (message: string) => void }

const fmt = (m: number) => (m > 0 ? `${Math.floor(m / 60)}h ${m % 60}m` : '—');

const AdminAddPermissionDrawer: React.FC<Props> = ({ onClose, onSaved }) => {
  const [employees, setEmployees] = useState<any[] | null>(null);
  const [form, setForm] = useState({ employee_id: '', permission_date: companyDateStr(), start_time: '14:00', end_time: '15:30', reason: '', approveNow: true });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    shiftService.getAssignableEmployees().then(({ data, error: e }) => {
      if (e) setError(`Employees could not be loaded: ${e.message || 'unknown error'}`);
      setEmployees(data || []);
    });
  }, []);
  const set = (patch: Partial<typeof form>) => setForm(f => ({ ...f, ...patch }));
  const minutes = permissionService.calculateDurationMinutes(form.start_time || '00:00', form.end_time || '00:00');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    const { data, error: err } = await permissionService.createPermissionForEmployee(form.employee_id, {
      permission_date: form.permission_date, start_time: form.start_time, end_time: form.end_time, reason: form.reason,
    }, form.approveNow);
    setSaving(false);
    if (err) {
      setError(err.message);
      if (data) onSaved(`Permission saved as ${data.status}; approval needs attention.`);
      return;
    }
    onSaved(data?.status === 'APPROVED' ? 'Permission added and approved.' : 'Permission added as pending.');
    onClose();
  };

  return (
    <div className="drawer-overlay" onClick={() => !saving && onClose()}>
      <div className="drawer wide-drawer" onClick={e => e.stopPropagation()}>
        <div className="drawer-header">
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Add Permission (Admin)</h2>
          <button className="icon-button" onClick={onClose} disabled={saving} aria-label="Close"><X size={20} /></button>
        </div>
        <div className="drawer-body">
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div>
              <label className="form-label" htmlFor="ap-emp">Employee *</label>
              <select id="ap-emp" required className="form-control" value={form.employee_id} onChange={e => set({ employee_id: e.target.value })}>
                <option value="">{employees === null ? 'Loading…' : 'Select employee'}</option>
                {(employees || []).map(x => <option key={x.id} value={x.id}>{x.first_name} {x.last_name} ({x.employee_code})</option>)}
              </select>
            </div>
            <div><label className="form-label" htmlFor="ap-date">Date *</label><input id="ap-date" required type="date" className="form-control" value={form.permission_date} onChange={e => set({ permission_date: e.target.value })} /></div>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <div style={{ flex: 1 }}><label className="form-label" htmlFor="ap-start">Start Time *</label><input id="ap-start" required type="time" className="form-control" value={form.start_time} onChange={e => set({ start_time: e.target.value })} /></div>
              <div style={{ flex: 1 }}><label className="form-label" htmlFor="ap-end">End Time *</label><input id="ap-end" required type="time" className="form-control" value={form.end_time} onChange={e => set({ end_time: e.target.value })} /></div>
            </div>
            <div><label className="form-label">Duration</label><input type="text" className="form-control" disabled value={fmt(minutes)} style={{ backgroundColor: 'var(--gray-100)' }} aria-label="Duration" /></div>
            <div><label className="form-label" htmlFor="ap-reason">Reason *</label><textarea id="ap-reason" required className="form-control" rows={3} value={form.reason} onChange={e => set({ reason: e.target.value })} /></div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}>
              <input type="checkbox" checked={form.approveNow} onChange={e => set({ approveNow: e.target.checked })} /> Approve now (otherwise it is saved as pending)
            </label>
            {error && <div role="alert" style={{ backgroundColor: 'var(--danger-50, #fef2f2)', color: 'var(--danger-700, #b91c1c)', padding: '0.75rem', borderRadius: 'var(--radius-md)', fontSize: '0.8125rem' }}>{error}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button type="button" className="btn btn-outline" onClick={onClose} disabled={saving}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving || minutes <= 0}>{saving ? 'Saving…' : 'Save Permission'}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default AdminAddPermissionDrawer;
