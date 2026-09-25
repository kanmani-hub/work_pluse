import React from 'react';
import { CalendarClock, Download } from 'lucide-react';

const mockAttendance = [
  { id: 1, date: 'Oct 24, 2024', name: 'John Doe', checkIn: '08:55 AM', checkOut: '06:05 PM', status: 'Present', hours: '9h 10m' },
  { id: 2, date: 'Oct 24, 2024', name: 'Sarah Adams', checkIn: '09:15 AM', checkOut: '06:00 PM', status: 'Late', hours: '8h 45m' },
  { id: 3, date: 'Oct 24, 2024', name: 'Michael King', checkIn: '-', checkOut: '-', status: 'On Leave', hours: '0h 0m' },
  { id: 4, date: 'Oct 24, 2024', name: 'Emily Larson', checkIn: '08:50 AM', checkOut: '05:30 PM', status: 'Present', hours: '8h 40m' },
];

const Attendance: React.FC = () => {
  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Attendance Log</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>Monitor employee daily attendance and working hours.</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-outline">
            <Download size={18} />
            Export
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: '0' }}>
        <div style={{ padding: '1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <input type="date" className="btn btn-outline" defaultValue="2024-10-24" style={{ outline: 'none' }} />
          <select className="btn btn-outline" style={{ outline: 'none' }}>
            <option>All Departments</option>
            <option>Engineering</option>
            <option>Design</option>
            <option>HR</option>
          </select>
        </div>
        
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Date</th>
                <th>Check In</th>
                <th>Check Out</th>
                <th>Total Hours</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {mockAttendance.map((record) => (
                <tr key={record.id}>
                  <td>
                    <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{record.name}</div>
                  </td>
                  <td>{record.date}</td>
                  <td>{record.checkIn}</td>
                  <td>{record.checkOut}</td>
                  <td>{record.hours}</td>
                  <td>
                    <span className={`badge ${
                      record.status === 'Present' ? 'badge-success' : 
                      record.status === 'Late' ? 'badge-warning' : 'badge-gray'
                    }`}>
                      {record.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Attendance;
