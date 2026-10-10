import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { MetricDetail } from '../../services/payroll/dailyMetricDetails';

interface Props {
  metric: MetricDetail | null;
  dateLabel: string;
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
}

const money = (n: number) => `₹${(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** Breakdown behind one payroll summary card (Today / Custom date view). Uses the page's modal styles. */
const DailyMetricModal: React.FC<Props> = ({ metric, dateLabel, loading, error, onClose }) => {
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  const openKey = metric?.key ?? null;

  // Focus Close and listen for Escape once per opened card (not on every parent re-render)
  useEffect(() => {
    if (!openKey) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openKey]);

  if (!metric) return null;
  const titleId = `metric-title-${metric.key}`;
  const color = metric.isDeduction ? 'var(--danger)' : 'var(--success)';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby={titleId}
        onClick={e => e.stopPropagation()}
        style={{ width: '95%', maxWidth: '1100px', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-color)' }}>
          <div style={{ minWidth: 0 }}>
            <h2 className="modal-title" id={titleId}>{metric.title}</h2>
            <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>{dateLabel}</div>
          </div>
          <button ref={closeRef} onClick={onClose} className="icon-button" aria-label="Close"><X size={20} /></button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', overflowY: 'auto', minHeight: 0, padding: '1.25rem 1.5rem' }}>
          {loading ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading…</div>
          ) : error ? (
            <div role="alert" style={{ padding: '1rem', border: '1px solid var(--danger)', borderRadius: 'var(--radius-md)', color: 'var(--danger)' }}>
              The breakdown could not be loaded: {error}
            </div>
          ) : (
            <>
              <div className="card" style={{ padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                <span style={{ fontWeight: 600 }}>Total</span>
                <span style={{ fontSize: '1.5rem', fontWeight: 700, color: metric.total > 0 ? color : 'var(--text-secondary)' }}>{money(metric.total)}</span>
              </div>

              {metric.rows.length === 0 ? (
                <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-secondary)' }}>{metric.emptyMessage}</div>
              ) : (
                <div className="table-container" style={{ overflowX: 'auto' }}>
                  <table className="table" style={{ width: '100%', minWidth: `${Math.max(640, metric.columns.length * 110)}px` }}>
                    <thead>
                      <tr>{metric.columns.map(c => <th key={c.key} style={{ textAlign: c.align || 'left' }}>{c.label}</th>)}</tr>
                    </thead>
                    <tbody>
                      {metric.rows.map((r, i) => (
                        <tr key={`${r.code}-${i}`}>
                          {metric.columns.map(c => (
                            <td key={c.key} style={{ textAlign: c.align || 'left', fontWeight: c.key === 'amount' ? 600 : undefined }}>
                              {c.money ? money(r[c.key]) : String(r[c.key] ?? '—')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={metric.columns.length - 1} style={{ fontWeight: 600 }}>Total</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color }}>{money(metric.total)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}

              {metric.explanation.length > 0 && (
                <div className="card" style={{ padding: '1rem', fontSize: '0.8125rem' }}>
                  <div style={{ fontWeight: 600, marginBottom: '0.375rem' }}>How this is calculated</div>
                  <ul style={{ margin: 0, paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.25rem', color: 'var(--text-secondary)' }}>
                    {metric.explanation.map((t, i) => <li key={i}>{t}</li>)}
                  </ul>
                </div>
              )}
              {metric.notes.length > 0 && (
                <div role="note" style={{ padding: '0.75rem 1rem', border: '1px solid var(--warning)', borderRadius: 'var(--radius-md)', fontSize: '0.8125rem' }}>
                  {metric.notes.map((t, i) => <div key={i}>{t}</div>)}
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

export default DailyMetricModal;
