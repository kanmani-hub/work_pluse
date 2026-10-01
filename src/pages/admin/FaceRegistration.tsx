import React, { useState, useEffect, useRef } from 'react';
import { 
  Camera, CheckCircle2, AlertCircle, X, Shield, 
  MapPin, Clock, Search, Filter, ShieldCheck, User
} from 'lucide-react';
import { faceService } from '../../services/face/faceService';
import { supabase } from '../../lib/supabase';

const FaceRegistration: React.FC = () => {
  const [employees, setEmployees] = useState<any[]>([]);
  const [filteredEmployees, setFilteredEmployees] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [selectedEmp, setSelectedEmp] = useState<any>(null);
  const [step, setStep] = useState(0); // 0=list, 1=detail, 2=camera, 3=capture_result
  const [loading, setLoading] = useState(true);

  // Camera State
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);

  const fetchEmployees = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('employees')
      .select(`
        id, 
        first_name, 
        last_name, 
        employee_code, 
        department:department_id(name), 
        office:office_id(name), 
        face_registrations!face_registrations_employee_id_fkey(registration_status, registered_at, is_active),
        shift_assignments!shift_assignments_employee_id_fkey(effective_date, shift_templates(name, start_time, end_time))
      `)
      .eq('status', 'ACTIVE');
      
    if (data) {
      const emps = data.map((e: any) => {
         const activeReg = e.face_registrations?.find((r: any) => r.is_active);
         let currentShift = null;
         if (e.shift_assignments && e.shift_assignments.length > 0) {
           const sortedAssignments = [...e.shift_assignments].sort((a: any, b: any) => new Date(b.effective_date).getTime() - new Date(a.effective_date).getTime());
           const mostRecent = sortedAssignments.find((sa: any) => new Date(sa.effective_date) <= new Date()) || sortedAssignments[0];
           if (mostRecent && mostRecent.shift_templates) {
              currentShift = {
                name: mostRecent.shift_templates.name,
                start_time: mostRecent.shift_templates.start_time,
                end_time: mostRecent.shift_templates.end_time
              };
           }
         }
         return {
           id: e.id,
           empCode: e.employee_code,
           name: `${e.first_name} ${e.last_name}`,
           dept: e.department?.name || '-',
           office: e.office?.name || '-',
           status: activeReg ? (activeReg.registration_status === 'REGISTERED' ? 'Registered' : activeReg.registration_status === 'REVOKED' ? 'Suspended' : 'Registration Pending') : 'Not Registered',
           date: activeReg?.registered_at ? new Date(activeReg.registered_at).toLocaleDateString() : '-',
           shift: currentShift ? `${currentShift.name}\n${currentShift.start_time?.slice(0,5)} - ${currentShift.end_time?.slice(0,5)}` : 'No shift assigned'
         };
      });
      setEmployees(emps);
      setFilteredEmployees(emps);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchEmployees();
  }, []);

  useEffect(() => {
    if (search) {
      setFilteredEmployees(employees.filter(e => e.name.toLowerCase().includes(search.toLowerCase()) || e.empCode.toLowerCase().includes(search.toLowerCase())));
    } else {
      setFilteredEmployees(employees);
    }
  }, [search, employees]);

  // Clean up camera when component unmounts or step changes
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [step]);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  };

  const startRegistration = (emp: any) => {
    setSelectedEmp(emp);
    setStep(1);
    setCapturedImage(null);
    setCameraError(null);
  };

  const initCamera = async () => {
    setStep(2);
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err: any) {
      console.error("Camera access error:", err);
      setCameraError("Camera access denied or unavailable. Please check permissions.");
    }
  };

  const captureFace = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      setCapturedImage(canvas.toDataURL('image/jpeg'));
      stopCamera();
      setStep(3);
    }
  };

  const completeRegistration = async () => {
    if (selectedEmp.status === 'Registered' || selectedEmp.status === 'Suspended') {
      const { data: reg } = await faceService.getFaceRegistration(selectedEmp.id);
      if (reg) await faceService.revokeFaceRegistration(reg.id);
    }
    
    // In a real flow, the capturedImage would be sent to the provider.
    if (!capturedImage) {
      alert('No image captured.');
      return;
    }
    const { error } = await faceService.registerFaceAdmin(selectedEmp.id, capturedImage);
    
    if (error) {
      if (error.message.includes('pending') || error.message.includes('NOT_CONFIGURED')) {
        alert("Face verification provider is NOT configured. Cannot complete registration.");
      } else {
        alert(error.message);
      }
      setStep(0);
      return;
    }

    await fetchEmployees();
    setStep(0);
  };

  const handleDisable = async (empId: string) => {
    const { data: reg } = await faceService.getFaceRegistration(empId);
    if (reg) {
      await faceService.revokeFaceRegistration(reg.id);
      await fetchEmployees();
    }
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
      
      {step === 0 && (
        <>
          <div className="page-header" style={{ marginBottom: 0 }}>
            <div>
              <h1 className="page-title">Face Registration</h1>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>Manage employee biometric face profiles for secure attendance.</p>
            </div>
          </div>
          
          <div className="card" style={{ padding: 0 }}>
            <div style={{ padding: '1rem', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: '1rem' }}>
              <div style={{ position: 'relative', flex: 1, maxWidth: '300px' }}>
                <Search size={14} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
                <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search employee..." className="form-control" style={{ paddingLeft: '2rem', fontSize: '0.875rem' }} />
              </div>
            </div>
            
            {loading ? (
              <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading employees...</div>
            ) : employees.length === 0 ? (
              <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                <User size={48} style={{ margin: '0 auto 1rem auto', opacity: 0.3 }} />
                <h3 style={{ fontSize: '1.125rem', color: 'var(--text-primary)' }}>No employees available for face registration.</h3>
              </div>
            ) : (
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
                    {filteredEmployees.map(emp => (
                      <tr key={emp.id}>
                        <td style={{ fontWeight: 500 }}>{emp.name}</td>
                        <td>{emp.empCode}</td>
                        <td>{emp.dept}</td>
                        <td>{emp.office}</td>
                        <td>{getStatusBadge(emp.status)}</td>
                        <td>{emp.date}</td>
                        <td style={{ textAlign: 'right' }}>
                          {emp.status === 'Registered' ? (
                            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                              <button onClick={() => startRegistration(emp)} className="btn btn-outline" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}>Re-register</button>
                              <button onClick={() => handleDisable(emp.id)} className="btn btn-outline" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', color: 'var(--danger-600)', borderColor: 'var(--danger-200)' }}>Disable</button>
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
            )}
          </div>
        </>
      )}

      {step > 0 && (
        <div style={{ maxWidth: '800px', margin: '0 auto', width: '100%' }}>
          
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <ShieldCheck size={24} color="var(--primary-600)" />
              Face Registration Workflow
            </h2>
            <button onClick={() => setStep(0)} className="icon-button"><X size={20}/></button>
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
                    <div style={{ color: 'var(--text-secondary)' }}>{selectedEmp.empCode} — {selectedEmp.dept}</div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', backgroundColor: 'var(--gray-50)', padding: '1.5rem', borderRadius: 'var(--radius-md)', marginBottom: '2rem' }}>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Assigned Office</div>
                    <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}><MapPin size={16} color="var(--primary-600)"/> {selectedEmp.office}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Face Registration Status</div>
                    <div style={{ fontWeight: 600 }}>{getStatusBadge(selectedEmp.status)}</div>
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Assigned Shift</div>
                    <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem', whiteSpace: 'pre-line' }}>
                      <Clock size={16} color="var(--primary-600)"/> 
                      {selectedEmp.shift}
                    </div>
                  </div>
                </div>

                {selectedEmp.status === 'Registered' && (
                  <div style={{ backgroundColor: 'var(--warning-50)', border: '1px solid var(--warning-200)', padding: '1rem', borderRadius: 'var(--radius-md)', marginBottom: '2rem', display: 'flex', gap: '0.75rem' }}>
                    <AlertCircle size={20} color="var(--warning)" />
                    <div>
                      <div style={{ fontWeight: 600, color: 'var(--warning-800)', fontSize: '0.875rem' }}>Re-register Face</div>
                      <div style={{ fontSize: '0.875rem', color: 'var(--warning)', marginTop: '0.25rem' }}>This employee already has a registered face profile. Proceeding will overwrite the existing data.</div>
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
                <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem', textAlign: 'center' }}>Step 2: Live Camera Preview</h3>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', textAlign: 'center' }}>Position your face inside the frame.</p>
                
                {cameraError ? (
                  <div style={{ color: 'var(--danger)', padding: '2rem', textAlign: 'center', backgroundColor: 'var(--danger-50)', borderRadius: 'var(--radius-lg)', marginBottom: '2rem' }}>
                    <AlertCircle size={32} style={{ margin: '0 auto 1rem auto' }} />
                    <p>{cameraError}</p>
                    <button onClick={initCamera} className="btn btn-primary" style={{ marginTop: '1rem' }}>Retry Camera</button>
                  </div>
                ) : (
                  <div style={{ position: 'relative', width: '320px', height: '400px', backgroundColor: '#111827', borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: '2rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    
                    <video 
                      ref={videoRef}
                      autoPlay 
                      playsInline 
                      muted 
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />

                    <div style={{ position: 'absolute', inset: 0, opacity: 0.2, backgroundImage: 'linear-gradient(45deg, #000 25%, transparent 25%, transparent 75%, #000 75%, #000), linear-gradient(45deg, #000 25%, transparent 25%, transparent 75%, #000 75%, #000)', backgroundSize: '20px 20px', backgroundPosition: '0 0, 10px 10px', pointerEvents: 'none' }} />
                    <div style={{ width: '200px', height: '260px', border: '2px dashed rgba(255,255,255,0.7)', borderRadius: '50% 50% 40% 40%', position: 'absolute', zIndex: 10, pointerEvents: 'none' }}></div>
                  </div>
                )}

                <div style={{ display: 'flex', gap: '1rem', width: '100%', maxWidth: '320px' }}>
                  <button onClick={() => setStep(1)} className="btn btn-outline" style={{ flex: 1 }}>Back</button>
                  <button onClick={captureFace} disabled={!!cameraError} className="btn btn-primary" style={{ flex: 2 }}><Camera size={18} style={{ marginRight: '0.5rem' }}/> Capture</button>
                </div>
              </div>
            )}

            {step === 3 && (
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem', textAlign: 'center' }}>Step 3: Registration Result</h3>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', textAlign: 'center' }}>Confirm registration for {selectedEmp.name}.</p>
                
                <div style={{ width: '320px', height: '400px', backgroundColor: 'var(--gray-100)', borderRadius: 'var(--radius-lg)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden', marginBottom: '2rem' }}>
                  {capturedImage ? (
                    <img src={capturedImage} alt="Captured face" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <User size={64} color="var(--gray-300)" />
                  )}
                </div>

                <div style={{ display: 'flex', gap: '1rem', width: '100%', maxWidth: '320px' }}>
                  <button onClick={initCamera} className="btn btn-outline" style={{ flex: 1 }}>Retake</button>
                  <button onClick={completeRegistration} className="btn btn-primary" style={{ flex: 2 }}>Register Face</button>
                </div>
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  );
};

export default FaceRegistration;
