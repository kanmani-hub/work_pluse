import React from 'react';
import { Lock } from 'lucide-react';

interface PayslipDocumentProps {
  currentPayslip: any;
}

const PayslipDocument: React.FC<PayslipDocumentProps> = ({ currentPayslip }) => {
  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      {/* Document Container */}
      <div className="payslip-document" style={{ width: '100%', maxWidth: '800px', backgroundColor: 'var(--bg-primary)', padding: '2rem', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)' }}>
        
        {/* Header */}
        <div style={{ textAlign: 'center', borderBottom: '2px solid var(--border-color)', paddingBottom: '1.5rem', marginBottom: '2rem' }}>
          <h2 className="payslip-title" style={{ fontSize: '1.5rem', fontWeight: 800, margin: '0 0 0.5rem 0' }}>WorkPulse HR</h2>
          <div className="payslip-subtitle" style={{ fontSize: '1.125rem', color: 'var(--text-secondary)' }}>Salary Slip</div>
          <div className="payslip-month" style={{ fontSize: '1rem', fontWeight: 600, marginTop: '0.25rem' }}>{currentPayslip?.payslip_period}</div>
        </div>

        {/* Employee Info Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '2rem', fontSize: '0.875rem' }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border-color)' }}><span className="payslip-label" style={{ color: 'var(--text-secondary)' }}>Name:</span> <strong className="payslip-value">{currentPayslip?.payroll?.employees?.first_name || 'Employee'} {currentPayslip?.payroll?.employees?.last_name || ''}</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid var(--border-color)' }}><span className="payslip-label" style={{ color: 'var(--text-secondary)' }}>Payslip No:</span> <strong className="payslip-value">{currentPayslip?.payslip_number}</strong></div>
          </div>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border-color)' }}><span className="payslip-label" style={{ color: 'var(--text-secondary)' }}>Employee ID:</span> <strong className="payslip-value">{currentPayslip?.payroll?.employees?.employee_code || '-'}</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid var(--border-color)' }}><span className="payslip-label" style={{ color: 'var(--text-secondary)' }}>Designation:</span> <strong className="payslip-value">{currentPayslip?.payroll?.employees?.designation || currentPayslip?.payroll?.employees?.departments?.name || '-'}</strong></div>
          </div>
        </div>

        {/* Net Salary Summary Box */}
        <div style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '1.5rem', margin: '2rem 0', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="payslip-label" style={{ color: 'var(--text-secondary)' }}>Gross Salary:</span>
            <span className="payslip-value" style={{ fontWeight: 600 }}>₹{currentPayslip ? Number(currentPayslip.payroll?.gross_salary).toLocaleString('en-IN', {minimumFractionDigits:2, maximumFractionDigits:2}) : '0.00'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'var(--danger)', fontWeight: 500 }}>Total Deductions:</span>
            <span style={{ fontWeight: 600, color: 'var(--danger)' }}>-₹{currentPayslip ? Number(currentPayslip.payroll?.total_deductions).toLocaleString('en-IN', {minimumFractionDigits:2, maximumFractionDigits:2}) : '0.00'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'var(--success)', fontWeight: 500 }}>Approved Overtime:</span>
            <span style={{ fontWeight: 600, color: 'var(--success)' }}>+₹{currentPayslip ? Number(currentPayslip.payroll?.overtime_amount || 0).toLocaleString('en-IN', {minimumFractionDigits:2, maximumFractionDigits:2}) : '0.00'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '2px dashed var(--border-color)', paddingTop: '1rem', marginTop: '0.5rem' }}>
            <span style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>Net Salary:</span>
            <span style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--success)' }}>₹{currentPayslip ? Number(currentPayslip.payroll?.net_salary).toLocaleString('en-IN', {minimumFractionDigits:2, maximumFractionDigits:2}) : '0.00'}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)', padding: '1rem', borderRadius: 'var(--radius-sm)' }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}><span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Payment Status</span><strong style={{ color: currentPayslip?.payroll?.status === 'PAID' ? 'var(--success)' : 'var(--warning)' }}>{currentPayslip?.payroll?.status || 'PENDING'}</strong></div>
            <div style={{ display: 'flex', flexDirection: 'column' }}><span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Payment Date</span><strong className="payslip-value">{currentPayslip?.payroll?.payroll_payments?.[0]?.paid_at ? new Date(currentPayslip.payroll.payroll_payments[0].paid_at).toLocaleDateString('en-GB') : '-'}</strong></div>
          </div>
        </div>

        {/* Locked Warning */}
        <div style={{ marginTop: '3rem', padding: '1rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', display: 'flex', gap: '0.75rem', color: 'var(--text-secondary)', backgroundColor: 'var(--bg-elevated)', alignItems: 'center' }}>
          <Lock size={18} style={{ flexShrink: 0 }} />
          <div style={{ fontSize: '0.875rem' }}>
            <strong style={{ display: 'block', color: 'var(--text-primary)' }}>Payroll Locked</strong>
            This payslip represents a finalized payroll run. Any corrections require authorized HR action.
          </div>
        </div>
        
        <div style={{ textAlign: 'center', marginTop: '2rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          This is a system-generated document and does not require a physical signature.
        </div>
      </div>
    </div>
  );
};

export default PayslipDocument;
