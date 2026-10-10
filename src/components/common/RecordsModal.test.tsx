import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import RecordsModal from './RecordsModal';

const cols = [{ key: 'employee', label: 'Employee' }, { key: 'code', label: 'Employee ID' }];
const base = { title: 'Present Employees', columns: cols, onClose: () => {} };

describe('RecordsModal (shared card detail view)', () => {
  it('renders nothing when closed', () => {
    expect(renderToStaticMarkup(<RecordsModal {...base} open={false} rows={[{ employee: 'A', code: 'E1' }]} />)).toBe('');
  });
  it('is an accessible dialog with a Close action, the total and the records', () => {
    const html = renderToStaticMarkup(<RecordsModal {...base} open total={2} totalLabel="Employees" rows={[{ employee: 'Asha', code: 'E1' }, { employee: 'Ravi', code: 'E2' }]} explanation={['Same rows as the card.']} />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="Close"');
    expect(html).toContain('>Close<');
    expect(html).toContain('Asha'); expect(html).toContain('Ravi');
    expect(html).toContain('Employees');
    expect(html).toContain('Search these records');
    expect(html).toContain('Same rows as the card.');
  });
  it('shows the empty state with the count 0', () => {
    const html = renderToStaticMarkup(<RecordsModal {...base} open rows={[]} emptyMessage="No one is present." />);
    expect(html).toContain('No one is present.');
    expect(html).toContain('>0<');
    expect(html).not.toContain('Search these records');
  });
  it('shows loading and error states instead of rows', () => {
    const loading = renderToStaticMarkup(<RecordsModal {...base} open loading rows={[{ employee: 'Asha', code: 'E1' }]} />);
    expect(loading).toContain('Loading'); expect(loading).not.toContain('Asha');
    const err = renderToStaticMarkup(<RecordsModal {...base} open error="permission denied" rows={[{ employee: 'Asha', code: 'E1' }]} />);
    expect(err).toContain('role="alert"'); expect(err).toContain('permission denied'); expect(err).not.toContain('Asha');
  });
  it('formats cells with the column formatter and shows — for missing values', () => {
    const html = renderToStaticMarkup(<RecordsModal {...base} open columns={[...cols, { key: 'amount', label: 'Amount', format: (v: any) => `₹${v}` }]} rows={[{ employee: 'Asha', code: null, amount: 50 }]} />);
    expect(html).toContain('₹50'); expect(html).toContain('—');
  });
});
