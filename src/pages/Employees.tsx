import React from 'react';
import { Plus, Search, Filter } from 'lucide-react';

const mockEmployees = [
  { id: 'EMP-001', name: 'John Doe', role: 'Product Manager', dept: 'Product', status: 'Active', type: 'Full-time' },
  { id: 'EMP-002', name: 'Sarah Adams', role: 'UI/UX Designer', dept: 'Design', status: 'Active', type: 'Full-time' },
  { id: 'EMP-003', name: 'Michael King', role: 'Senior Developer', dept: 'Engineering', status: 'On Leave', type: 'Full-time' },
  { id: 'EMP-004', name: 'Emily Larson', role: 'HR Specialist', dept: 'Human Resources', status: 'Active', type: 'Contract' },
  { id: 'EMP-005', name: 'Robert James', role: 'Marketing Lead', dept: 'Marketing', status: 'Active', type: 'Full-time' },
];

const Employees: React.FC = () => {
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
              {mockEmployees.map((emp) => (
                <tr key={emp.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <div className="avatar" style={{ width: '36px', height: '36px' }}>
                        {emp.name.split(' ').map(n => n[0]).join('')}
                      </div>
                      <div>
                        <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{emp.name}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{emp.role}</div>
                      </div>
                    </div>
                  </td>
                  <td>{emp.id}</td>
                  <td>{emp.dept}</td>
                  <td>{emp.type}</td>
                  <td>
                    <span className={`badge ${emp.status === 'Active' ? 'badge-success' : 'badge-warning'}`}>
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
          <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Showing 1 to 5 of 142 entries</span>
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
