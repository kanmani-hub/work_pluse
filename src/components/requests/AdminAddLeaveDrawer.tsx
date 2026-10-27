import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { leaveService } from '../../services/leave/leaveService';
import { shiftService } from '../../services/shifts/shiftService';
import { companyDateStr } from '../../utils/companyDate';

/**
 * Admin → Leave → Add Leave: saves a real leave request for an employee (replaces the old drawer that
 * showed "Leave created successfully" without saving). Success is shown only after the database
 * confirmed the save (and, with "Approve now", the approval).
 */
interface Props {
  leaveTypes: { id: string; name: string; active: boolean }[] | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}

const AdminAddLeaveDrawer: React.FC<Props> = ({ leaveTypes, onClose, onSaved }) => {
  const today = companyDateStr();
  const [employees, setEmployees] = useState<any[] | null>(null);
  const [form, setForm] = useState({ employee_id: '', leave_type_id: '', start_date: today, end_date: today, is_half_day: false, half_day_type: 'FIRST_HALF' as 'FIRST_HALF' | 'SECOND_HALF', reason: '', approveNow: true });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    shiftService.getAssignableEmployees().then(({ data, error: e }) => {
      if (e) setError(`Employees could not be loaded: ${e.message || 'unknown error'}`);
      setEmployees(data || []);
    });
  }, []);

  const types = (leaveTypes || []).filter(t => t.active);
  const set = (patch: Partial<typeof form>) => setForm(f => ({ ...f, ...patch }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;   // no double submit
    setSaving(true);
    setError('');
    const { data, error: err } = await leaveService.createLeaveForEmployee(form.employee_id, {
      leave_type_id: form.leave_type_id,
      start_date: form.start_date,
      end_date: form.is_half_day ? form.start_date : form.end_date,
      is_half_day: form.is_half_day,
      half_day_type: form.is_half_day ? form.half_day_type : undefined,
      reason: form.reason,
    }, form.approveNow);
    setSaving(false);
    if (err) {
      setError(err.message);
      if (data) onSaved(`Leave saved as ${data.status}; approval needs attention.`);   // refresh the list: a row exists
      return;
    }
    onSaved(data?.status === 'APPROVED' ? 'Leave added and approved.' : 'Leave added as pending.');
    onClose();
  };

  return (
    <div className="drawer-overlay" onClick={() => !saving && onClose()}>
      <div className="drawer wide-drawer" onClick={e => e.stopPropagation()}>
        <div className="drawer-header">
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Add Leave (Admin)</h2>
          <button className="icon-button" onClick={onClose} disabled={saving} aria-label="Close"><X size={20} /></button>
        </div>
        <div className="drawer-body">
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>Record leave on behalf of an employee. You cannot approve your own leave.</p>
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div>
              <label className="form-label" htmlFor="al-emp">Employee *</label>
              <select id="al-emp" required className="form-control" value={form.employee_id} onChange={e => set({ employee_id: e.target.value })}>
                <option value="">{employees === null ? 'Loading…' : 'Select employee'}</option>
                {(employees || []).map(x => <option key={x.id} value={x.id}>{x.first_name} {x.last_name} ({x.employee_code})</option>)}
              </select>
            </div>
            <div>
              <label className="form-label" htmlFor="al-type">Leave Type *</label>
              <select id="al-type" required className="form-control" value={form.leave_type_id} onChange={e => set({ leave_type_id: e.target.value })}>
                <option value="">{leaveTypes === null ? 'Loading…' : types.length ? 'Select leave type' : 'No active leave types'}</option>
                {types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}>
              <input type="checkbox" checked={form.is_half_day} onChange={e => set({ is_half_day: e.target.checked })} /> Half day
            </label>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <div style={{ flex: 1 }}><label className="form-label" htmlFor="al-start">{form.is_half_day ? 'Date *' : 'Start Date *'}</label><input id="al-start" required type="date" className="form-control" value={form.start_date} onChange={e => set({ start_date: e.target.value })} /></div>
              {form.is_half_day ? (
                <div style={{ flex: 1 }}><label className="form-label" htmlFor="al-half">Half</label>
                  <select id="al-half" className="form-control" value={form.half_day_type} onChange={e => set({ half_day_type: e.target.value as any })}>
                    <option value="FIRST_HALF">First half</option><option value="SECOND_HALF">Second half</option>
                  </select></div>
              ) : (
                <div style={{ flex: 1 }}><label className="form-label" htmlFor="al-end">End Date *</label><input id="al-end" required type="date" min={form.start_date} className="form-control" value={form.end_date} onChange={e => set({ end_date: e.target.value })} /></div>
              )}
            </div>
            <div><label className="form-label" htmlFor="al-reason">Reason *</label><textarea id="al-reason" required className="form-control" rows={3} value={form.reason} onChange={e => set({ reason: e.target.value })} /></div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}>
              <input type="checkbox" checked={form.approveNow} onChange={e => set({ approveNow: e.target.checked })} /> Approve now (otherwise it is saved as pending)
            </label>
            {error && <div role="alert" style={{ backgroundColor: 'var(--danger-50, #fef2f2)', color: 'var(--danger-700, #b91c1c)', padding: '0.75rem', borderRadius: 'var(--radius-md)', fontSize: '0.8125rem' }}>{error}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button type="button" className="btn btn-outline" onClick={onClose} disabled={saving}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save Leave'}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default AdminAddLeaveDrawer;
