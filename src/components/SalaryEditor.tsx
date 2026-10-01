import React, { useState, useEffect } from 'react';
import { salaryService } from '../services/payroll/salaryService';
import { payrollService } from '../services/payroll/payrollService';
import { AlertTriangle } from 'lucide-react';

interface SalaryEditorProps {
  employeeId: string;
  payrollYear?: number;
  payrollMonth?: number;
  onSuccess?: () => void;
  onCancel?: () => void;
}

const SalaryEditor: React.FC<SalaryEditorProps> = ({ employeeId, payrollYear, payrollMonth, onSuccess, onCancel }) => {
  const [salaryStructure, setSalaryStructure] = useState<any>(null);
  const [isEditingSalary, setIsEditingSalary] = useState(false);
  const [salaryLoading, setSalaryLoading] = useState(false);
  const [salaryForm, setSalaryForm] = useState<any>({});
  const [toast, setToast] = useState('');

  const loadEmployeeSalary = async () => {
    setSalaryLoading(true);
    const { data } = await salaryService.getEmployeeSalaryStructure(employeeId);
    setSalaryStructure(data);
    if (data) {
      setSalaryForm(data);
    } else {
      setSalaryForm({
        basic_salary: 0, hra: 0, transport_allowance: 0,
        medical_allowance: 0, special_allowance: 0, other_allowances: 0,
        standard_deduction: 0
      });
    }
    setSalaryLoading(false);
  };

  useEffect(() => {
    loadEmployeeSalary();
  }, [employeeId]);

  const handleSalarySave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSalaryLoading(true);
    
    if (Number(salaryForm.basic_salary) < 0) {
      alert(`Gross salary cannot be negative`);
      setSalaryLoading(false);
      return;
    }

    // We send only basic_salary as requested
    const { error } = await salaryService.updateSalaryStructure(employeeId, {
      basic_salary: Number(salaryForm.basic_salary)
    });
    if (error) {
      alert(error.message);
    } else {
      const date = new Date();
      const year = payrollYear || date.getFullYear();
      const month = payrollMonth || date.getMonth() + 1;
      const periodStart = new Date(year, month - 1, 1).toISOString();
      const periodEnd = new Date(year, month, 0).toISOString();
      
      const recalcRes = await payrollService.recalculatePayroll(employeeId, year, month, periodStart, periodEnd);
      // We don't alert on recalcRes.error if it's locked, but if it's another error we should know.
      if (recalcRes.error && !recalcRes.error.message.includes('Cannot recalculate')) {
        console.error("Recalculation error:", recalcRes.error);
        alert("Salary saved, but recalculation failed: " + recalcRes.error.message);
      }
      
      setToast('Salary structure saved successfully');
      setTimeout(() => setToast(''), 3000);
      await loadEmployeeSalary();
      if (onSuccess) onSuccess();
    }
    setSalaryLoading(false);
  };

  if (salaryLoading && !salaryStructure) {
    return <div style={{ padding: '2rem', textAlign: 'center' }}>Loading salary structure...</div>;
  }

  return (
    <div>
      {toast && (
        <div style={{ padding: '0.75rem', backgroundColor: 'var(--success-50)', color: 'var(--success-800)', border: '1px solid var(--success-200)', borderRadius: 'var(--radius-md)', marginBottom: '1rem' }}>
          {toast}
        </div>
      )}
      
      <div style={{ marginBottom: '1.5rem' }}>
        <h3 className="section-title" style={{ margin: 0 }}>Salary Structure</h3>
      </div>

      <form onSubmit={handleSalarySave}>
        <div style={{ marginBottom: '1.5rem' }}>
          <label className="form-label">Gross Salary *</label>
          <input 
            type="number" 
            required 
            className="form-control" 
            value={salaryForm.basic_salary ?? ''} 
            onChange={e => setSalaryForm({...salaryForm, basic_salary: e.target.value})} 
          />
        </div>
        
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button 
            type="button" 
            onClick={() => {
              setSalaryForm(salaryStructure || {});
              if (onCancel) onCancel();
            }} 
            className="btn btn-outline" 
            style={{ flex: 1 }}
          >
            Cancel
          </button>
          <button 
            type="submit" 
            className="btn btn-primary" 
            style={{ flex: 1 }}
            disabled={salaryLoading}
          >
            {salaryLoading ? 'Saving...' : 'Save Salary Structure'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default SalaryEditor;
