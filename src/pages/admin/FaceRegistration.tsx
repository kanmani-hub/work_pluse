import React, { useState } from 'react';
import { 
  Camera, CheckCircle2, AlertCircle, RefreshCw, X, Shield, 
  MapPin, Clock, Search, Filter, ShieldCheck, User, ShieldAlert
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const mockEmployees = [
  { id: 'EMP1024', name: 'Anitha Kumar', dept: 'Engineering', office: 'Chennai Office', status: 'Registered', date: '24 Sep 2026', shift: 'General Shift' },
  { id: 'EMP1025', name: 'Sanjay Dutt', dept: 'Sales', office: 'Bangalore Office', status: 'Not Registered', date: '-', shift: 'Morning Shift' },
  { id: 'EMP1026', name: 'Priya Sharma', dept: 'HR', office: 'Chennai Office', status: 'Registration Pending', date: '-', shift: 'General Shift' },
  { id: 'EMP1027', name: 'Arun Kumar', dept: 'Engineering', office: 'Pune Office', status: 'Suspended', date: '15 Aug 2026', shift: 'Evening Shift' },
];

const FaceRegistration: React.FC = () => {
  const navigate = useNavigate();
  const [employees, setEmployees] = useState(mockEmployees);
  const [selectedEmp, setSelectedEmp] = useState<any>(null);
  const [step, setStep] = useState(0); // 0 = list, 1 = employee detail, 2 = camera, 3 = capture/quality, 4 = confirm, 5 = success
  const [cameraState, setCameraState] = useState<'loading'|'ready'|'error'|'poor_light'|'no_face'|'multiple'>('loading');
  const [qualityChecks, setQualityChecks] = useState({ detection: false, position: false, lighting: false, single: false });

  const startRegistration = (emp: any) => {
    setSelectedEmp(emp);
    setStep(1);
  };

  const initCamera = () => {
    setStep(2);
    setCameraState('loading');
    setTimeout(() => {
      setCameraState('ready');
    }, 1500);
  };

  const handleCapture = () => {
    setStep(3);
    setQualityChecks({ detection: false, position: false, lighting: false, single: false });
    
    // Simulate quality checks
    setTimeout(() => setQualityChecks(prev => ({ ...prev, detection: true })), 500);
    setTimeout(() => setQualityChecks(prev => ({ ...prev, position: true })), 1000);
    setTimeout(() => setQualityChecks(prev => ({ ...prev, lighting: true })), 1500);
    setTimeout(() => setQualityChecks(prev => ({ ...prev, single: true })), 2000);
  };

  const handleConfirm = () => {
    setStep(4);
  };

  const completeRegistration = () => {
    setEmployees(prev => prev.map(e => e.id === selectedEmp.id ? { ...e, status: 'Registered', date: 'Today' } : e));
    setStep(5);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'Registered': return <span className="badge badge-success">Registered</span>;
      case 'Not Registered': return <span className="badge badge-gray">Not Registered</span>;
      case 'Registration Pending': return <span className="badge badge-warning">Registration Pending</span>;
      case 'Suspended': return <span className="badge badge-danger">Suspended</span>;
      default: return <span className="badge">{status}</span>;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      
      {step === 0 ? (
        <>
          <div className="page-header" style={{ marginBottom: 0 }}>
            <div>
              <h1 className="page-title">Face Registration</h1>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>Manage employee biometric face profiles for secure attendance.</p>
            </div>
            <div>
              <button className="btn btn-outline"><Filter size={16}/> Filter</button>
            </div>
          </div>
          
          <div className="card" style={{ padding: 0 }}>
            <div style={{ padding: '1rem', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: '1rem' }}>
              <div style={{ position: 'relative', flex: 1, maxWidth: '300px' }}>
                <Search size={14} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
                <input type="text" placeholder="Search employee..." className="form-control" style={{ paddingLeft: '2rem', fontSize: '0.875rem' }} />
              </div>
            </div>
            <div className="table-container">
              <table className="table" style={{ width: '100%', fontSize: '0.875rem' }}>
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Employee ID</th>
                    <th>Department</th>
                    <th>Office</th>
                    <th>Face Status</th>
                    <th>Registered On</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map(emp => (
                    <tr key={emp.id}>
                      <td style={{ fontWeight: 500 }}>{emp.name}</td>
                      <td>{emp.id}</td>
                      <td>{emp.dept}</td>
                      <td>{emp.office}</td>
                      <td>{getStatusBadge(emp.status)}</td>
                      <td>{emp.date}</td>
                      <td style={{ textAlign: 'right' }}>
                        {emp.status === 'Registered' ? (
                          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                            <button onClick={() => startRegistration(emp)} className="btn btn-outline" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}>Re-register</button>
                            <button className="btn btn-outline" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', color: 'var(--danger-600)', borderColor: 'var(--danger-200)' }}>Disable</button>
                          </div>
                        ) : (
                          <button onClick={() => startRegistration(emp)} className="btn btn-primary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}>Register Face</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <div style={{ maxWidth: '800px', margin: '0 auto', width: '100%' }}>
          
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <ShieldCheck size={24} color="var(--primary-600)" />
              Face Registration Workflow
            </h2>
            <button onClick={() => setStep(0)} className="icon-button"><X size={20}/></button>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '2rem' }}>
            {[1, 2, 3, 4, 5].map(s => (
              <div key={s} style={{ flex: 1, height: '4px', backgroundColor: s <= step ? 'var(--primary-500)' : 'var(--gray-200)', borderRadius: '2px' }} />
            ))}
          </div>

          <div className="card" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            
            {step === 1 && (
              <div style={{ width: '100%' }}>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem', textAlign: 'center' }}>Step 1: Employee Verification</h3>
                
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
                  <div style={{ width: '80px', height: '80px', backgroundColor: 'var(--primary-100)', color: 'var(--primary-700)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2rem', fontWeight: 600 }}>
                    {selectedEmp.name.charAt(0)}
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '1.25rem', fontWeight: 600 }}>{selectedEmp.name}</div>
                    <div style={{ color: 'var(--text-secondary)' }}>{selectedEmp.id} — {selectedEmp.dept}</div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', backgroundColor: 'var(--gray-50)', padding: '1.5rem', borderRadius: 'var(--radius-md)', marginBottom: '2rem' }}>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Assigned Office</div>
                    <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}><MapPin size={16} color="var(--primary-600)"/> {selectedEmp.office}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Geofence Radius</div>
                    <div style={{ fontWeight: 600 }}>200 meters</div>
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Assigned Shift</div>
                    <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Clock size={16} color="var(--primary-600)"/> {selectedEmp.shift} (9:00 AM - 6:00 PM)</div>
                  </div>
                </div>

                {selectedEmp.status === 'Registered' && (
                  <div style={{ backgroundColor: 'var(--warning-50)', border: '1px solid var(--warning-200)', padding: '1rem', borderRadius: 'var(--radius-md)', marginBottom: '2rem', display: 'flex', gap: '0.75rem' }}>
                    <AlertCircle size={20} color="var(--warning)" />
                    <div>
                      <div style={{ fontWeight: 600, color: 'var(--warning-800)', fontSize: '0.875rem' }}>Re-register Face</div>
                      <div style={{ fontSize: '0.875rem', color: 'var(--warning)', marginTop: '0.25rem' }}>This employee already has a registered face profile. Proceeding will overwrite the existing data.</div>
                      <input type="text" placeholder="Reason for re-registration (Required)" className="form-control" style={{ marginTop: '0.75rem', width: '100%', borderColor: 'var(--warning-300)' }} />
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', gap: '1rem' }}>
                  <button onClick={() => setStep(0)} className="btn btn-outline" style={{ flex: 1 }}>Cancel</button>
                  <button onClick={initCamera} className="btn btn-primary" style={{ flex: 1 }}>Start Face Registration</button>
                </div>
              </div>
            )}

            {step === 2 && (
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem', textAlign: 'center' }}>Step 2: Camera Capture</h3>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', textAlign: 'center' }}>Position the employee's face inside the frame.</p>
                
                <div style={{ position: 'relative', width: '320px', height: '400px', backgroundColor: '#111827', borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: '2rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  
                  {cameraState === 'loading' && (
                    <div style={{ color: 'white', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                      <RefreshCw size={32} className="spin" />
                      <span>Starting camera...</span>
                    </div>
                  )}

                  {cameraState === 'ready' && (
                    <>
                      <div style={{ position: 'absolute', inset: 0, opacity: 0.2, backgroundImage: 'linear-gradient(45deg, #000 25%, transparent 25%, transparent 75%, #000 75%, #000), linear-gradient(45deg, #000 25%, transparent 25%, transparent 75%, #000 75%, #000)', backgroundSize: '20px 20px', backgroundPosition: '0 0, 10px 10px' }} />
                      <div style={{ width: '200px', height: '260px', border: '2px dashed rgba(255,255,255,0.7)', borderRadius: '50% 50% 40% 40%', position: 'absolute', zIndex: 10 }}></div>
                      <div style={{ position: 'absolute', bottom: '1rem', left: '50%', transform: 'translateX(-50%)', backgroundColor: 'rgba(0,0,0,0.6)', color: 'white', padding: '0.25rem 0.75rem', borderRadius: 'var(--radius-full)', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--success)' }}></div>
                        Camera Ready
                      </div>
                      
                      {/* Simulators for UI testing */}
                      <div style={{ position: 'absolute', top: '1rem', right: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', zIndex: 20 }}>
                        <button onClick={() => setCameraState('poor_light')} className="btn" style={{ fontSize: '0.75rem', padding: '0.25rem', backgroundColor: 'rgba(255,255,255,0.2)', color: 'white', border: '1px solid white' }}>Sim: Poor Light</button>
                        <button onClick={() => setCameraState('no_face')} className="btn" style={{ fontSize: '0.75rem', padding: '0.25rem', backgroundColor: 'rgba(255,255,255,0.2)', color: 'white', border: '1px solid white' }}>Sim: No Face</button>
                      </div>
                    </>
                  )}

                  {cameraState === 'poor_light' && (
                    <div style={{ color: 'var(--warning-400)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', textAlign: 'center', padding: '2rem' }}>
                      <AlertCircle size={32} />
                      <span>Lighting is too low. Ask the employee to move to a brighter area.</span>
                      <button onClick={() => setCameraState('ready')} className="btn btn-outline" style={{ borderColor: 'var(--warning-400)', color: 'var(--warning-400)', marginTop: '1rem' }}>Retry</button>
                    </div>
                  )}

                  {cameraState === 'no_face' && (
                    <div style={{ color: 'var(--danger-400)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', textAlign: 'center', padding: '2rem' }}>
                      <User size={32} />
                      <span>No face detected. Position the employee inside the frame.</span>
                      <button onClick={() => setCameraState('ready')} className="btn btn-outline" style={{ borderColor: 'var(--danger-400)', color: 'var(--danger-400)', marginTop: '1rem' }}>Retry</button>
                    </div>
                  )}

                </div>

                <div style={{ display: 'flex', gap: '1rem', width: '100%', maxWidth: '320px' }}>
                  <button onClick={() => setStep(1)} className="btn btn-outline" style={{ flex: 1 }}>Back</button>
                  <button onClick={handleCapture} disabled={cameraState !== 'ready'} className="btn btn-primary" style={{ flex: 2 }}><Camera size={18} style={{ marginRight: '0.5rem' }}/> Capture</button>
                </div>
              </div>
            )}

            {step === 3 && (
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem', textAlign: 'center' }}>Step 3: Quality Check</h3>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', textAlign: 'center' }}>Analyzing captured biometric data.</p>
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', width: '100%', marginBottom: '2rem' }}>
                  <div style={{ width: '100%', height: '240px', backgroundColor: 'var(--gray-100)', borderRadius: 'var(--radius-lg)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
                    <User size={64} color="var(--gray-300)" />
                    {qualityChecks.single && <div style={{ position: 'absolute', inset: 0, border: '4px solid var(--success)', borderRadius: 'var(--radius-lg)' }} />}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', justifyContent: 'center' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>Face Detection</span>
                      {qualityChecks.detection ? <CheckCircle2 size={18} color="var(--success)" /> : <RefreshCw size={16} className="spin" color="var(--gray-400)" />}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>Face Position</span>
                      {qualityChecks.position ? <CheckCircle2 size={18} color="var(--success)" /> : <RefreshCw size={16} className="spin" color="var(--gray-400)" />}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>Lighting</span>
                      {qualityChecks.lighting ? <CheckCircle2 size={18} color="var(--success)" /> : <RefreshCw size={16} className="spin" color="var(--gray-400)" />}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>Single Face</span>
                      {qualityChecks.single ? <CheckCircle2 size={18} color="var(--success)" /> : <RefreshCw size={16} className="spin" color="var(--gray-400)" />}
                    </div>
                    
                    {qualityChecks.single && (
                      <div style={{ marginTop: '1rem', padding: '0.75rem', backgroundColor: 'var(--success-50)', borderRadius: 'var(--radius-md)', border: '1px solid var(--success-200)', textAlign: 'center' }}>
                        <strong style={{ color: 'var(--success-800)', fontSize: '0.875rem' }}>Registration Quality: Good</strong>
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '1rem', width: '100%', maxWidth: '320px' }}>
                  <button onClick={() => setStep(2)} className="btn btn-outline" style={{ flex: 1 }}>Retake</button>
                  <button onClick={handleConfirm} disabled={!qualityChecks.single} className="btn btn-primary" style={{ flex: 2 }}>Register Face</button>
                </div>
              </div>
            )}

            {step === 4 && (
              <div style={{ width: '100%', textAlign: 'center' }}>
                <div style={{ width: '64px', height: '64px', backgroundColor: 'var(--primary-100)', color: 'var(--primary-600)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem auto' }}>
                  <Shield size={32} />
                </div>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>Register Face Profile?</h3>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>This face profile will be securely associated with <strong>{selectedEmp.name}</strong> for secure attendance verification.</p>
                
                <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
                  <button onClick={() => setStep(0)} className="btn btn-outline">Cancel</button>
                  <button onClick={completeRegistration} className="btn btn-primary">Confirm Registration</button>
                </div>
              </div>
            )}

            {step === 5 && (
              <div style={{ width: '100%', textAlign: 'center' }}>
                <div style={{ width: '80px', height: '80px', backgroundColor: 'var(--success-50)', color: 'var(--success)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem auto' }}>
                  <CheckCircle2 size={40} />
                </div>
                <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>Face Registered Successfully</h2>
                <div style={{ fontSize: '1.125rem', fontWeight: 500, marginBottom: '0.25rem' }}>{selectedEmp.name}</div>
                <div style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>{selectedEmp.id}</div>
                
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem', backgroundColor: 'var(--success-50)', borderRadius: 'var(--radius-full)', border: '1px solid var(--success-200)', marginBottom: '2rem' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--success)' }} />
                  <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--success-800)' }}>Face Registration Active</span>
                </div>

                <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
                  <button onClick={() => setStep(0)} className="btn btn-outline">Done</button>
                  <button onClick={() => setStep(0)} className="btn btn-primary">View Employee</button>
                </div>
              </div>
            )}

          </div>
        </div>
      )}

      <style>{`
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};

export default FaceRegistration;


