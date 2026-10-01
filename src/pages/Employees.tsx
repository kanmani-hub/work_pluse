import React from 'react';
import { Plus, Search, Filter } from 'lucide-react';

import { useEffect, useState } from 'react';
import { employeeService, type EmployeeWithRelations } from '../services/employees/employeeService';
import { Loader2 } from 'lucide-react';

const Employees: React.FC = () => {
  const [employees, setEmployees] = useState<EmployeeWithRelations[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadEmployees() {
      setLoading(true);
      const { data } = await employeeService.getEmployees();
      if (data) {
        setEmployees(data);
      }
      setLoading(false);
    }
    loadEmployees();
  }, []);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Employees</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>Manage your workforce directory.</p>
        </div>
        <button className="btn btn-primary">
          <Plus size={18} />
          Add Employee
        </button>
      </div>

      <div className="card" style={{ padding: '0' }}>
        <div style={{ padding: '1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: '1rem', flexWrap: 'wrap', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: '0.5rem', flex: 1, minWidth: '250px' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search size={18} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
              <input type="text" placeholder="Search employees..." style={{ width: '100%', padding: '0.5rem 1rem 0.5rem 2.25rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', outline: 'none' }} />
            </div>
          </div>
          <button className="btn btn-outline">
            <Filter size={18} />
            Filters
          </button>
        </div>
        
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>ID</th>
                <th>Department</th>
                <th>Employment</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '2rem' }}>
                    <Loader2 size={24} className="spinner" style={{ margin: '0 auto', color: 'var(--primary-500)' }} />
                  </td>
                </tr>
              ) : employees.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
                    No employees found
                  </td>
                </tr>
              ) : employees.map((emp) => (
                <tr key={emp.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <div className="avatar" style={{ width: '36px', height: '36px' }}>
                        {emp.first_name[0]}{emp.last_name[0]}
                      </div>
                      <div>
                        <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{emp.first_name} {emp.last_name}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{emp.designation || '-'}</div>
                      </div>
                    </div>
                  </td>
                  <td>{emp.employee_code}</td>
                  <td>{emp.department?.name || '-'}</td>
                  <td>{emp.employment_type || '-'}</td>
                  <td>
                    <span className={`badge ${emp.status === 'ACTIVE' ? 'badge-success' : 'badge-warning'}`}>
                      {emp.status}
                    </span>
                  </td>
                  <td>
                    <button style={{ color: 'var(--primary-600)', fontWeight: 500, fontSize: '0.875rem' }}>Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Showing {employees.length} entries</span>
          <div style={{ display: 'flex', gap: '0.25rem' }}>
            <button className="btn btn-outline" style={{ padding: '0.25rem 0.75rem' }}>Previous</button>
            <button className="btn btn-outline" style={{ padding: '0.25rem 0.75rem' }}>Next</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Employees;
