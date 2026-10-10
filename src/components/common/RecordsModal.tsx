import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Search } from 'lucide-react';
import { filterRecords, type RecordColumn } from '../../services/common/cardDetails';

/**
 * Shared detail view for summary cards (all modules). Shows the records behind a card:
 * title, count / total, a searchable table, an optional calculation explanation, and
 * loading / empty / error states. Read-only: nothing is saved or changed by opening it.
 * Escape and the Close button close it; focus moves to Close when it opens and returns to
 * the card that opened it when it closes.
 */
export interface RecordsModalProps {
  open: boolean;
  title: string;
  subtitle?: string;
  /** Shown big at the top; defaults to the number of records */
  total?: React.ReactNode;
  totalLabel?: string;
  columns: RecordColumn[];
  rows: Record<string, any>[];
  /** Row keys used by the search box (defaults to all text columns) */
  searchKeys?: string[];
  loading?: boolean;
  error?: string | null;
  emptyMessage?: string;
  explanation?: string[];
  notes?: string[];
  onClose: () => void;
}

const cell = (v: any) => (v === null || v === undefined || v === '' ? '—' : String(v));

const RecordsModal: React.FC<RecordsModalProps> = ({
  open, title, subtitle, total, totalLabel = 'Records', columns, rows, searchKeys, loading, error,
  emptyMessage = 'No matching records were found.', explanation = [], notes = [], onClose,
}) => {
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const [query, setQuery] = useState('');
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); opener?.focus?.(); };
  }, [open]);

  useEffect(() => { if (!open) setQuery(''); }, [open]);

  const visible = useMemo(() => filterRecords(rows || [], query, searchKeys || columns.map(c => c.key)), [rows, query, searchKeys, columns]);
  if (!open) return null;
  const titleId = `records-title-${title.replace(/\W+/g, '-').toLowerCase()}`;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={e => e.stopPropagation()}
        style={{ width: '95%', maxWidth: '1100px', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-color)' }}>
          <div style={{ minWidth: 0 }}>
            <h2 className="modal-title" id={titleId}>{title}</h2>
            {subtitle && <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>{subtitle}</div>}
          </div>
          <button ref={closeRef} onClick={onClose} className="icon-button" aria-label="Close"><X size={20} /></button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', overflowY: 'auto', minHeight: 0, padding: '1.25rem 1.5rem' }}>
          {loading ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }} role="status">Loading…</div>
          ) : error ? (
            <div role="alert" style={{ padding: '1rem', border: '1px solid var(--danger)', borderRadius: 'var(--radius-md)', color: 'var(--danger)' }}>
              The details could not be loaded: {error}
            </div>
          ) : (
            <>
              <div className="card" style={{ padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                <span style={{ fontWeight: 600 }}>{totalLabel}</span>
                <span style={{ fontSize: '1.5rem', fontWeight: 700 }}>{total ?? rows.length}</span>
              </div>

              {rows.length > 0 && (
                <div style={{ position: 'relative' }}>
                  <Search size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
                  <input className="form-control" style={{ paddingLeft: '2.25rem' }} placeholder="Search these records" aria-label="Search these records"
                    value={query} onChange={e => setQuery(e.target.value)} />
                </div>
              )}

              {rows.length === 0 ? (
                <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-secondary)' }}>{emptyMessage}</div>
              ) : visible.length === 0 ? (
                <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-secondary)' }}>No records match “{query}”.</div>
              ) : (
                <div className="table-container" style={{ overflowX: 'auto' }}>
                  <table className="table" style={{ width: '100%', minWidth: `${Math.max(560, columns.length * 120)}px` }}>
                    <thead><tr>{columns.map(c => <th key={c.key} style={{ textAlign: c.align || 'left' }}>{c.label}</th>)}</tr></thead>
                    <tbody>
                      {visible.map((r, i) => (
                        <tr key={r.__key ?? i}>
                          {columns.map(c => <td key={c.key} style={{ textAlign: c.align || 'left' }}>{c.format ? c.format(r[c.key], r) : cell(r[c.key])}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {query && <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>Showing {visible.length} of {rows.length}</div>}
                </div>
              )}

              {explanation.length > 0 && (
                <div className="card" style={{ padding: '1rem', fontSize: '0.8125rem' }}>
                  <div style={{ fontWeight: 600, marginBottom: '0.375rem' }}>How this is calculated</div>
                  <ul style={{ margin: 0, paddingLeft: '1.25rem', color: 'var(--text-secondary)' }}>{explanation.map((t, i) => <li key={i}>{t}</li>)}</ul>
                </div>
              )}
              {notes.length > 0 && (
                <div role="note" style={{ padding: '0.75rem 1rem', border: '1px solid var(--warning)', borderRadius: 'var(--radius-md)', fontSize: '0.8125rem' }}>
                  {notes.map((t, i) => <div key={i}>{t}</div>)}
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '1rem 1.5rem', borderTop: '1px solid var(--border-color)' }}>
          <button type="button" className="btn btn-outline" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};

export default RecordsModal;
