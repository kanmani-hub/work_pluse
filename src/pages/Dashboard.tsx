import React from 'react';
import { Users, UserCheck, CalendarOff, ArrowUpRight, ArrowDownRight } from 'lucide-react';

const Dashboard: React.FC = () => {
  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>Welcome back, John. Here is what's happening today.</p>
        </div>
        <button className="btn btn-primary">Download Report</button>
      </div>

      <div className="dashboard-stats">
        <div className="card stat-card">
          <div className="stat-header">
            <span>Total Employees</span>
            <Users className="stat-icon" size={32} />
          </div>
          <div className="stat-value">142</div>
          <div className="stat-footer">
            <span className="stat-trend positive">
              <ArrowUpRight size={16} /> 12%
            </span>
            <span>vs last month</span>
          </div>
        </div>

        <div className="card stat-card">
          <div className="stat-header">
            <span>Present Today</span>
            <UserCheck className="stat-icon success" size={32} />
          </div>
          <div className="stat-value">128</div>
          <div className="stat-footer">
            <span className="stat-trend positive">
              <ArrowUpRight size={16} /> 4%
            </span>
            <span>vs yesterday</span>
          </div>
        </div>

        <div className="card stat-card">
          <div className="stat-header">
            <span>On Leave</span>
            <CalendarOff className="stat-icon warning" size={32} />
          </div>
          <div className="stat-value">12</div>
          <div className="stat-footer">
            <span className="stat-trend negative">
              <ArrowDownRight size={16} /> 2%
            </span>
            <span>vs yesterday</span>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: '1.5rem' }}>
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Recent Leave Requests</h3>
            <button className="btn btn-outline" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}>View All</button>
          </div>
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Type</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <div className="avatar" style={{ width: '32px', height: '32px' }}>SA</div>
                      <div>
                        <div style={{ fontWeight: 500 }}>Sarah Adams</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Design</div>
                      </div>
                    </div>
                  </td>
                  <td>Sick Leave</td>
                  <td><span className="badge badge-warning">Pending</span></td>
                </tr>
                <tr>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <div className="avatar" style={{ width: '32px', height: '32px' }}>MK</div>
                      <div>
                        <div style={{ fontWeight: 500 }}>Michael King</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Engineering</div>
                      </div>
                    </div>
                  </td>
                  <td>Annual</td>
                  <td><span className="badge badge-success">Approved</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Upcoming Birthdays</h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div className="avatar" style={{ backgroundColor: 'var(--success-50)', color: 'var(--success)' }}>RJ</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500 }}>Robert James</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Marketing • Tomorrow</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div className="avatar" style={{ backgroundColor: 'var(--primary-50)', color: 'var(--primary-700)' }}>EL</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500 }}>Emily Larson</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>HR • Sep 28</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
