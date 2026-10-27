import { describe, it, expect, vi, beforeEach } from 'vitest';

// Regression tests: employee -> admin notifications go through rpc('notify_admins')
// (migration 20261022090200_notification_integrity.sql), never through direct inserts for other people.
const rpc = vi.fn();
const from = vi.fn();
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: (...a: any[]) => rpc(...a), from: (...a: any[]) => from(...a) } }));
vi.mock('../payroll/salaryService', () => ({ salaryService: { getCurrentEmployeeId: vi.fn(async () => 'emp-1') } }));

import { notificationService } from './notificationService';

describe('notificationService admin alerts', () => {
  beforeEach(() => { rpc.mockReset(); from.mockReset(); });

  it('notifyAdmins calls notify_admins and does not read employees or insert rows itself', async () => {
    rpc.mockResolvedValue({ data: 3, error: null });
    const res = await notificationService.notifyAdmins({ notification_type: 'LEAVE', title: 'New Leave Request', message: 'm', entity_type: 'leave_requests', entity_id: 'id-1' });
    expect(rpc).toHaveBeenCalledWith('notify_admins', expect.objectContaining({ p_type: 'LEAVE', p_title: 'New Leave Request', p_entity_id: 'id-1', p_priority: 'NORMAL' }));
    expect(from).not.toHaveBeenCalled();
    expect(res).toEqual({ count: 3, error: null });
  });

  it('notifyAdmins reports a server refusal', async () => {
    const err = { code: '42501', message: 'Not authenticated' };
    rpc.mockResolvedValue({ data: null, error: err });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await notificationService.notifyAdmins({ notification_type: 'WFH', title: 't', message: 'm' });
    expect(res).toEqual({ count: 0, error: err });
    spy.mockRestore();
  });

  it('geofence alerts go through notify_admins with the event id (server de-duplicates)', async () => {
    rpc.mockResolvedValue({ data: 2, error: null });
    await notificationService.notifyGeofenceEvent({ event_type: 'EXITED', employeeName: 'Eli', employeeCode: 'E1', empId: 'emp-1', eventId: 'ev-1', distance: 120 });
    expect(rpc).toHaveBeenCalledWith('notify_admins', expect.objectContaining({ p_type: 'GEOFENCE', p_priority: 'HIGH', p_entity_type: 'geofence_events', p_entity_id: 'ev-1' }));
    expect(from).not.toHaveBeenCalled();
  });

  it('unknown geofence event types send nothing', async () => {
    await notificationService.notifyGeofenceEvent({ event_type: 'OTHER', employeeName: 'Eli', employeeCode: 'E1', empId: 'emp-1' });
    expect(rpc).not.toHaveBeenCalled();
  });
});
