import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rosterService } from './rosterService';
import { salaryService } from '../payroll/salaryService';
import { auditService } from '../audit/auditService';
import { supabase } from '../../lib/supabase';
import { rosterDaysFromAssignments } from '../payroll/payrollDataService';

vi.mock('../payroll/salaryService');
vi.mock('../audit/auditService');
// In-memory tables with the filters the service uses. `denyWrites` emulates the database BEFORE the
// proposed migration (SELECT-only policies on rosters / roster_assignments).
vi.mock('../../lib/supabase', () => {
  const db: any = { tables: {}, denyWrites: false, seq: 0 };
  const from = (t: string) => {
    const q: any = { t, op: 'select', filters: [], payload: null, one: null, head: false, count: false, conflict: null };
    const rows = () => (db.tables[t] ||= []);
    const match = (r: any) => q.filters.every(([op, c, v]: any) =>
      op === 'eq' ? r[c] === v : op === 'neq' ? r[c] !== v : op === 'lte' ? r[c] <= v : op === 'gte' ? r[c] >= v : op === 'in' ? v.includes(r[c]) : true);
    const run = () => {
      if (q.op !== 'select' && db.denyWrites) return { data: null, error: { code: '42501', message: `new row violates row-level security policy for table "${t}"` } };
      if (q.op === 'insert') { const r = { id: `${t}-${++db.seq}`, ...q.payload }; rows().push(r); return { data: q.one ? r : [r], error: null }; }
      if (q.op === 'upsert') {
        const keys = String(q.conflict).split(',');
        const hit = rows().find((r: any) => keys.every(k => r[k] === q.payload[k]));
        if (hit) { Object.assign(hit, q.payload); return { data: q.one ? hit : [hit], error: null }; }
        const r = { id: `${t}-${++db.seq}`, ...q.payload }; rows().push(r); return { data: q.one ? r : [r], error: null };
      }
      if (q.op === 'update') { const hit = rows().filter(match); hit.forEach((r: any) => Object.assign(r, q.payload)); return { data: hit.map((r: any) => ({ ...r })), error: null }; }
      const hit = rows().filter(match).map((r: any) => ({ ...r }));
      if (q.head) return { data: null, count: hit.length, error: null };
      if (q.one) return hit.length > 1 ? { data: null, error: { message: 'multiple rows' } } : { data: hit[0] ?? null, error: null };
      return { data: hit, count: q.count ? hit.length : null, error: null };
    };
    const b: any = {
      select: (_c?: string, o?: any) => { if (o?.head) q.head = true; if (o?.count) q.count = true; return b; },
      insert: (p: any) => { q.op = 'insert'; q.payload = p; return b; },
      upsert: (p: any, o: any) => { q.op = 'upsert'; q.payload = p; q.conflict = o?.onConflict; return b; },
      update: (p: any) => { q.op = 'update'; q.payload = p; return b; },
      eq: (c: string, v: any) => { q.filters.push(['eq', c, v]); return b; },
      neq: (c: string, v: any) => { q.filters.push(['neq', c, v]); return b; },
      lte: (c: string, v: any) => { q.filters.push(['lte', c, v]); return b; },
      gte: (c: string, v: any) => { q.filters.push(['gte', c, v]); return b; },
      in: (c: string, v: any[]) => { q.filters.push(['in', c, v]); return b; },
      single: () => { q.one = 'single'; return b; },
      maybeSingle: () => { q.one = 'maybe'; return b; },
      then: (res: any, rej: any) => Promise.resolve().then(run).then(res, rej),
    };
    return b;
  };
  return { supabase: { from, __db: db } };
});

const db = (supabase as any).__db;
const WEEK = ['2026-10-12', '2026-10-18'] as const; // Mon–Sun, synthetic
const work = (shift = 's1', workMode: 'OFFICE' | 'WFH' = 'OFFICE') => ({ dayType: 'WORK' as const, shiftTemplateId: shift, workMode });
const weekOff = { dayType: 'WEEK_OFF' as const, shiftTemplateId: null, workMode: 'OFFICE' as const };
const roster = () => db.tables.rosters[0];
const entries = () => db.tables.roster_assignments || [];

beforeEach(() => {
  vi.clearAllMocks();
  db.tables = { rosters: [], roster_assignments: [], payroll: [] }; db.denyWrites = false; db.seq = 0;
  (salaryService.getCurrentEmployeeId as any).mockResolvedValue('admin1');
  (auditService.recordAuditLog as any).mockResolvedValue(undefined);
});

describe('saving roster cells', () => {
  it('the first save creates a DRAFT roster for the week and stores the shift and work mode', async () => {
    const r = await rosterService.saveCell(WEEK[0], WEEK[1], 'e1', '2026-10-12', work('s1', 'WFH'));
    expect(r.error).toBeNull();
    expect(roster()).toMatchObject({ start_date: WEEK[0], end_date: WEEK[1], status: 'DRAFT', created_by: 'admin1' });
    expect(entries()).toEqual([{ id: 'roster_assignments-2', roster_id: roster().id, employee_id: 'e1', assignment_date: '2026-10-12', day_type: 'WORK', shift_template_id: 's1', work_mode: 'WFH' }]);
  });

  it('a Week Off is saved (no shift), and saving the same day again updates it instead of adding a row', async () => {
    await rosterService.saveCell(WEEK[0], WEEK[1], 'e1', '2026-10-14', work());
    await rosterService.saveCell(WEEK[0], WEEK[1], 'e1', '2026-10-14', weekOff);
    expect(db.tables.rosters.length).toBe(1);
    expect(entries().length).toBe(1);
    expect(entries()[0]).toMatchObject({ assignment_date: '2026-10-14', day_type: 'WEEK_OFF', shift_template_id: null });
  });

  it('a date outside the week is refused', async () => {
    const r = await rosterService.saveCell(WEEK[0], WEEK[1], 'e1', '2026-10-19', work());
    expect(r.error?.message).toBe('The date 2026-10-19 is outside this roster (2026-10-12 to 2026-10-18).');
    expect(db.tables.rosters.length).toBe(0);
  });

  it('a published roster cannot be edited', async () => {
    await rosterService.saveCell(WEEK[0], WEEK[1], 'e1', '2026-10-12', work());
    await rosterService.publish(roster().id);
    const r = await rosterService.saveCell(WEEK[0], WEEK[1], 'e1', '2026-10-13', weekOff);
    expect(r.error?.message).toBe('This roster is published. Unpublish it before making changes.');
    expect(entries().length).toBe(1);
  });

  it('before the migration (read-only tables) the save fails with the database error — never reported as saved', async () => {
    db.denyWrites = true;
    const r = await rosterService.saveCell(WEEK[0], WEEK[1], 'e1', '2026-10-12', work());
    expect(r.data).toBeNull();
    expect(r.error?.message).toMatch('Roster could not be created: new row violates row-level security policy');
  });
});

describe('publishing', () => {
  it('DRAFT → PUBLISHED with who and when, and it is audited', async () => {
    await rosterService.saveCell(WEEK[0], WEEK[1], 'e1', '2026-10-12', work());
    const r = await rosterService.publish(roster().id);
    expect(r.error).toBeNull();
    expect(roster()).toMatchObject({ status: 'PUBLISHED', published_by: 'admin1' });
    expect(typeof roster().published_at).toBe('string');
    expect((auditService.recordAuditLog as any).mock.calls[0][0]).toMatchObject({ action: 'ROSTER_PUBLISHED', entity_id: roster().id });
  });

  it('publishing twice, an empty roster, or an overlapping week is refused', async () => {
    await rosterService.saveCell(WEEK[0], WEEK[1], 'e1', '2026-10-12', work());
    await rosterService.publish(roster().id);
    expect((await rosterService.publish(roster().id)).error?.message).toBe('This roster is already published.');
    db.tables.rosters.push({ id: 'empty', start_date: '2026-10-19', end_date: '2026-10-25', status: 'DRAFT' });
    expect((await rosterService.publish('empty')).error?.message).toBe('Save at least one roster entry before publishing.');
    db.tables.rosters.push({ id: 'overlap', start_date: '2026-10-15', end_date: '2026-10-21', status: 'DRAFT' });
    db.tables.roster_assignments.push({ id: 'x', roster_id: 'overlap', employee_id: 'e2', assignment_date: '2026-10-16', day_type: 'WORK' });
    expect((await rosterService.publish('overlap')).error?.message).toBe('Another published roster already covers some of these dates. Unpublish it first.');
    expect(db.tables.rosters.find((r: any) => r.id === 'overlap').status).toBe('DRAFT');
  });

  it('unpublish returns to DRAFT, but not once payroll for that month is approved or paid', async () => {
    await rosterService.saveCell(WEEK[0], WEEK[1], 'e1', '2026-10-12', work());
    await rosterService.publish(roster().id);
    db.tables.payroll.push({ id: 'p1', payroll_year: 2026, payroll_month: 10, status: 'APPROVED' });
    expect((await rosterService.unpublish(roster().id)).error?.message).toBe('Payroll for this period is already approved or paid, so its roster cannot be changed.');
    expect(roster().status).toBe('PUBLISHED');
    db.tables.payroll[0].status = 'UNDER_REVIEW';
    expect((await rosterService.unpublish(roster().id)).error).toBeNull();
    expect(roster()).toMatchObject({ status: 'DRAFT', published_at: null, published_by: null });
  });
});

describe('what payroll sees from saved roster data', () => {
  it('a saved Week Off and a rostered Sunday reach payroll only after publishing', async () => {
    await rosterService.saveCell(WEEK[0], WEEK[1], 'e1', '2026-10-13', weekOff);   // Tuesday off
    await rosterService.saveCell(WEEK[0], WEEK[1], 'e1', '2026-10-18', work());    // Sunday working
    const withRoster = () => entries().map((a: any) => ({ ...a, rosters: { ...db.tables.rosters.find((r: any) => r.id === a.roster_id) } }));
    expect(rosterDaysFromAssignments(withRoster(), WEEK[0], WEEK[1])).toEqual({});
    await rosterService.publish(roster().id);
    expect(rosterDaysFromAssignments(withRoster(), WEEK[0], WEEK[1])).toEqual({ '2026-10-13': 'OFF', '2026-10-18': 'WORK' });
  });

  it('getRosters returns saved rosters and entries in the visible range (archived excluded)', async () => {
    await rosterService.saveCell(WEEK[0], WEEK[1], 'e1', '2026-10-12', work());
    db.tables.rosters.push({ id: 'old', start_date: '2026-10-12', end_date: '2026-10-18', status: 'ARCHIVED' });
    const r = await rosterService.getRosters('2026-10-01', '2026-10-31');
    expect(r.error).toBeNull();
    expect(r.rosters.map((x: any) => x.status)).toEqual(['DRAFT']);
    expect(r.assignments.length).toBe(1);
  });
});

describe('roster periods are consistent and never overlap (2026-10-10 date fix)', () => {
  it('a period that is not Monday → Sunday (e.g. the old Sun–Sat week) is refused before anything is written', async () => {
    const r = await rosterService.saveCell('2026-10-11', '2026-10-17', 'e1', '2026-10-12', work());
    expect(r.error?.message).toBe('A roster must cover one Monday-to-Sunday week (got 2026-10-11 to 2026-10-17).');
    expect(db.tables.rosters.length).toBe(0);
    expect(entries().length).toBe(0);
  });

  it('a second roster overlapping an active one is refused (no duplicate or overlapping rosters are created)', async () => {
    db.tables.rosters.push({ id: 'legacy', start_date: '2026-10-11', end_date: '2026-10-17', status: 'DRAFT' }); // e.g. saved by the old page
    const r = await rosterService.saveCell(WEEK[0], WEEK[1], 'e1', '2026-10-12', work());
    expect(r.error?.message).toBe('Another roster (2026-10-11 to 2026-10-17) already covers some of these dates.');
    expect(db.tables.rosters.length).toBe(1);
    expect(entries().length).toBe(0);
  });

  it('an archived roster for the same week does not block planning the week again', async () => {
    db.tables.rosters.push({ id: 'old', start_date: WEEK[0], end_date: WEEK[1], status: 'ARCHIVED' });
    const r = await rosterService.saveCell(WEEK[0], WEEK[1], 'e1', '2026-10-12', work());
    expect(r.error).toBeNull();
    expect(db.tables.rosters.filter((x: any) => x.status === 'DRAFT').length).toBe(1);
  });

  it('saving several cells of the same week reuses one roster', async () => {
    for (const d of ['2026-10-12', '2026-10-13', '2026-10-18']) await rosterService.saveCell(WEEK[0], WEEK[1], 'e1', d, work());
    await rosterService.saveCell(WEEK[0], WEEK[1], 'e2', '2026-10-14', weekOff);
    expect(db.tables.rosters.length).toBe(1);
    expect(entries().length).toBe(4);
  });
});
