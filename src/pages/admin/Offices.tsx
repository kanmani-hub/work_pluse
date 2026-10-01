import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Building2, Search, Plus, Filter, MoreVertical, X, CheckCircle2, 
  AlertTriangle, Users, Eye, Edit, MapPin, ShieldAlert, Navigation, 
  Map as MapIcon, Crosshair, Check, UserPlus, Loader2
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { locationAutocomplete, type LocationSuggestion } from '../../services/location/locationAutocomplete';

const AdminOffices: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  
  const [offices, setOffices] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('All');
  const [filterGeofence, setFilterGeofence] = useState('All');
  
  const [activeMenu, setActiveMenu] = useState<string | null>(null);

  // Drawers & Modals
  const [showForm, setShowForm] = useState<string | boolean>(false);
  const [showDetail, setShowDetail] = useState<any>(null);
  const [assignModal, setAssignModal] = useState<any>(null);
  const [testGeofenceModal, setTestGeofenceModal] = useState<any>(null);
  
  const [simDistance, setSimDistance] = useState(120);

  // Form State
  const [formData, setFormData] = useState<any>({});
  const [formError, setFormError] = useState('');

  // Location autocomplete state
  const [locationQuery, setLocationQuery] = useState('');
  const [locationSuggestions, setLocationSuggestions] = useState<LocationSuggestion[]>([]);
  const [locationLoading, setLocationLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [locationError, setLocationError] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Fetch offices from Supabase
  const fetchOffices = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('offices').select('*, employees(id)').order('name');
    if (data) {
      setOffices(data.map((o: any) => ({
        id: o.id,
        name: o.name,
        code: o.name.replace(/\s+/g, '-').substring(0, 8).toUpperCase(),
        address: o.address || '',
        lat: o.latitude,
        lng: o.longitude,
        employees: o.employees ? o.employees.length : 0,
        radius: o.geofence_radius || 200,
        geofence: o.geofence_radius != null, // Assuming radius existence means enabled for now, or true if there's a flag
        status: o.is_active ? 'Active' : 'Inactive'
      })));
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchOffices();
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const filteredOffices = offices.filter(o => {
    const matchesSearch = o.name.toLowerCase().includes(search.toLowerCase()) || o.code.toLowerCase().includes(search.toLowerCase()) || o.address.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = filterStatus === 'All' || o.status === filterStatus;
    const matchesGeo = filterGeofence === 'All' || (filterGeofence === 'Enabled' && o.geofence) || (filterGeofence === 'Disabled' && !o.geofence);
    return matchesSearch && matchesStatus && matchesGeo;
  });

  const handleActionClick = (action: string, office: any) => {
    setActiveMenu(null);
    switch(action) {
      case 'view': setShowDetail(office); break;
      case 'edit': setFormData(office); setShowForm(office.id); break;
      case 'test': setTestGeofenceModal(office); setSimDistance(office.radius - 50); break;
    }
  };

  const handleSaveForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!formData.name || !formData.address) return setFormError('Name and Address are required.');
    
    if (formData.lat === undefined || formData.lat === '' || formData.lng === undefined || formData.lng === '') {
      return setFormError('Please select a valid location from the suggestions or enter coordinates manually.');
    }

    if (isNaN(parseFloat(formData.lat)) || formData.lat < -90 || formData.lat > 90) return setFormError('Enter a valid latitude between -90 and 90.');
    if (isNaN(parseFloat(formData.lng)) || formData.lng < -180 || formData.lng > 180) return setFormError('Enter a valid longitude between -180 and 180.');
    
    if (formData.geofence) {
      if (!formData.radius || isNaN(parseInt(formData.radius)) || formData.radius <= 0) return setFormError('Radius must be greater than 0.');
    }

    if (!showForm || typeof showForm === 'boolean') {
      // Create new office in Supabase
      const { error } = await (supabase.from('offices') as any).insert({
        name: formData.name,
        address: formData.address,
        latitude: parseFloat(formData.lat),
        longitude: parseFloat(formData.lng),
        geofence_radius: parseInt(formData.radius) || 200,
        is_active: (formData.status || 'Active') === 'Active'
      });
      if (error) { setFormError('Failed to save: ' + error.message); return; }
      showToast('Office created successfully');
    } else {
      // Update existing office in Supabase
      const { error } = await (supabase.from('offices') as any).update({
        name: formData.name,
        address: formData.address,
        latitude: parseFloat(formData.lat),
        longitude: parseFloat(formData.lng),
        geofence_radius: parseInt(formData.radius) || 200,
        is_active: (formData.status || 'Active') === 'Active'
      }).eq('id', showForm);
      if (error) { setFormError('Failed to update: ' + error.message); return; }
      showToast('Office updated successfully');
    }
    setShowForm(false);
    fetchOffices();
  };

  const handleAssignSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setAssignModal(null);
    showToast('Employees assigned successfully');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', position: 'relative' }}>
      
      {toast && (
        <div style={{ position: 'fixed', top: '24px', left: '50%', transform: 'translateX(-50%)', backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)', padding: '0.75rem 1.5rem', borderRadius: 'var(--radius-full)', zIndex: 1000, display: 'flex', alignItems: 'center', gap: '0.5rem', boxShadow: 'var(--shadow-lg)', animation: 'slideDown 0.3s forwards' }}>
          <CheckCircle2 size={18} color="var(--success)" />
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="page-header" style={{ marginBottom: 0, flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="page-title">Offices</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>Manage company offices, locations and attendance geofencing rules.</p>
        </div>
        <button onClick={() => { setFormData({ geofence: true, radius: 200, lat: 13.0827, lng: 80.2707 }); setFormError(''); setShowForm(true); }} className="btn btn-primary" style={{ fontSize: '0.875rem' }}><Plus size={16}/> Add Office</button>
      </div>

      {loading ? (
        <div className="skeleton-container" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
          {[...Array(4)].map((_, i) => <div key={i} className="skeleton" style={{ height: '90px', borderRadius: 'var(--radius-md)' }} />)}
        </div>
      ) : (
        <div className="kpi-grid">
          <div className="tracking-kpi-card">
            <div className="sc-header"><div className="sc-icon"><Building2 size={18} /></div></div>
            <div className="sc-val">{offices.length}</div>
            <div className="sc-title">Total Offices</div>
          </div>
          <div className="tracking-kpi-card">
            <div className="sc-header"><div className="sc-icon" style={{ backgroundColor: 'var(--success-100)', color: 'var(--success)' }}><CheckCircle2 size={18} /></div></div>
            <div className="sc-val" style={{ color: 'var(--success)' }}>{offices.filter(o => o.status === 'Active').length}</div>
            <div className="sc-title">Active Offices</div>
          </div>
          <div className="tracking-kpi-card" onClick={() => navigate('/admin/employees')} style={{ cursor: 'pointer' }}>
            <div className="sc-header"><div className="sc-icon" style={{ backgroundColor: 'var(--primary-100)', color: 'var(--primary-700)' }}><Users size={18} /></div></div>
            <div className="sc-val" style={{ color: 'var(--primary-700)' }}>{offices.reduce((acc, o) => acc + o.employees, 0)}</div>
            <div className="sc-title">Employees Assigned</div>
          </div>
          <div className="tracking-kpi-card">
            <div className="sc-header"><div className="sc-icon" style={{ backgroundColor: 'var(--warning-100)', color: 'var(--warning)' }}><MapPin size={18} /></div></div>
            <div className="sc-val" style={{ color: 'var(--warning)' }}>{offices.filter(o => o.geofence).length}</div>
            <div className="sc-title">Geofencing Enabled</div>
          </div>
        </div>
      )}

      {/* Main Table Card */}
      <div className="card" style={{ padding: 0 }}>
        {/* Toolbar */}
        <div style={{ padding: '1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          
          <div style={{ position: 'relative', width: '250px', flex: '1 1 auto', maxWidth: '300px' }}>
            <Search size={18} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search office name, code or address..." className="form-control" style={{ paddingLeft: '2.25rem' }} />
          </div>
          
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="form-control" style={{ width: 'auto' }}>
            <option value="All">All Statuses</option>
            <option>Active</option>
            <option>Inactive</option>
          </select>

          <select value={filterGeofence} onChange={e => setFilterGeofence(e.target.value)} className="form-control" style={{ width: 'auto' }}>
            <option value="All">All Geofencing</option>
            <option>Enabled</option>
            <option>Disabled</option>
          </select>
          
          {(search || filterStatus !== 'All' || filterGeofence !== 'All') && (
            <button onClick={() => { setSearch(''); setFilterStatus('All'); setFilterGeofence('All'); }} className="btn btn-outline" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>Clear</button>
          )}
        </div>

        {loading ? (
          <div className="skeleton" style={{ height: '300px', margin: '1rem' }} />
        ) : filteredOffices.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
            <Building2 size={48} style={{ margin: '0 auto 1rem auto', opacity: 0.3 }} />
            <h3 style={{ fontSize: '1.125rem', color: 'var(--text-primary)' }}>No offices found</h3>
            <p style={{ marginTop: '0.5rem' }}>Try changing your search or filters.</p>
            <button onClick={() => { setSearch(''); setFilterStatus('All'); setFilterGeofence('All'); }} className="btn btn-outline" style={{ marginTop: '1rem' }}>Clear Filters</button>
          </div>
        ) : (
          <div className="table-container">
            <table className="table" style={{ width: '100%', minWidth: '950px' }}>
              <thead>
                <tr>
                  <th>Office</th>
                  <th>Code</th>
                  <th>Address</th>
                  <th style={{ textAlign: 'right' }}>Employees</th>
                  <th>Radius</th>
                  <th>Geofence</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredOffices.map(office => (
                  <tr key={office.id}>
                    <td><div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{office.name}</div></td>
                    <td style={{ fontWeight: 600, fontFamily: 'monospace' }}>{office.code}</td>
                    <td style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{office.address}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{office.employees}</td>
                    <td style={{ fontSize: '0.875rem' }}>{office.radius} m</td>
                    <td>
                      <span className={`badge ${office.geofence ? 'badge-primary' : 'badge-gray'}`}>
                        {office.geofence ? 'Enabled' : 'Disabled'}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${office.status === 'Active' ? 'badge-success' : 'badge-gray'}`}>
                        {office.status}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', position: 'relative' }}>
                      <button onClick={() => setActiveMenu(activeMenu === office.id ? null : office.id)} className="icon-button"><MoreVertical size={18}/></button>
                      
                      {activeMenu === office.id && (
                        <div className="dropdown-menu" style={{ position: 'absolute', right: '30px', top: '12px', zIndex: 10 }}>
                          <button onClick={() => handleActionClick('view', office)} className="dropdown-item"><Eye size={14}/> View Details</button>
                          <button onClick={() => handleActionClick('edit', office)} className="dropdown-item"><Edit size={14}/> Edit Office</button>
                          {office.geofence && (
                            <button onClick={() => handleActionClick('test', office)} className="dropdown-item"><Crosshair size={14}/> Test Geofence</button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit Form Drawer */}
      {showForm && (
        <div className="drawer-overlay" onClick={() => setShowForm(false)}>
          <div className="drawer wide-drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>{typeof showForm === 'string' ? 'Edit Office' : 'Add Office'}</h2>
              <button className="icon-button" onClick={() => setShowForm(false)}><X size={20} /></button>
            </div>
            
            <form onSubmit={handleSaveForm} className="drawer-body" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
              
              {formError && (
                <div style={{ padding: '0.75rem', backgroundColor: 'var(--danger-50)', color: 'var(--danger)', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}>
                  <AlertTriangle size={16} /> {formError}
                </div>
              )}

              <section>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, borderBottom: '1px solid var(--gray-200)', paddingBottom: '0.5rem', marginBottom: '1rem' }}>Office Information</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label className="form-label">Office Name *</label>
                    <input required className="form-control" value={formData.name || ''} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="e.g. Chennai Main Office" />
                  </div>
                  <div style={{ gridColumn: '1 / -1', position: 'relative' }}>
                    <label className="form-label">Search Location</label>
                    <div style={{ position: 'relative' }}>
                      <input 
                        className="form-control" 
                        value={locationQuery} 
                        onChange={e => {
                          const val = e.target.value;
                          setLocationQuery(val);
                          setShowSuggestions(true);
                          setLocationError('');
                          
                          // Clear previous selection if admin starts typing again
                          if (formData.lat || formData.lng) {
                            setFormData({...formData, address: '', lat: '', lng: ''});
                          }

                          if (debounceRef.current) clearTimeout(debounceRef.current);
                          if (abortControllerRef.current) {
                            abortControllerRef.current.abort();
                            abortControllerRef.current = null;
                          }

                          if (val.trim().length >= 3) {
                            setLocationLoading(true);
                            debounceRef.current = setTimeout(async () => {
                              try {
                                const controller = new AbortController();
                                abortControllerRef.current = controller;
                                const results = await locationAutocomplete.search(val.trim(), controller.signal);
                                  setLocationSuggestions(results);
                                  setLocationError('');
                                  setLocationLoading(false);
                                } catch (err: any) {
                                  if (err.name !== 'AbortError' && err.message !== 'Aborted') {
                                    setLocationError('Location search is unavailable. Please enter the address and coordinates manually.');
                                    setLocationLoading(false);
                                  }
                                }
                            }, 500);
                          } else {
                            setLocationSuggestions([]);
                            setLocationLoading(false);
                          }
                        }}
                        onFocus={() => locationSuggestions.length > 0 && setShowSuggestions(true)}
                        placeholder="Search office location... (e.g. Guindy, Chennai)" 
                        style={{ paddingLeft: '2.25rem' }}
                      />
                      <MapPin size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
                      {locationLoading && <Loader2 size={16} className="spinner" style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--primary-500)' }} />}
                    </div>
                    
                    {showSuggestions && (
                      <div ref={suggestionsRef} style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, backgroundColor: 'var(--bg-surface-elevated)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)', marginTop: '4px', maxHeight: '220px', overflowY: 'auto' }}>
                        
                        {locationQuery.trim().length < 3 && !locationLoading && (
                          <div style={{ padding: '0.75rem', fontSize: '0.875rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
                            Type at least 3 characters to search
                          </div>
                        )}

                        {locationLoading && locationSuggestions.length === 0 && (
                          <div style={{ padding: '0.75rem', fontSize: '0.875rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
                            Searching locations...
                          </div>
                        )}

                        {locationError && !locationLoading && (
                          <div style={{ padding: '0.75rem', fontSize: '0.875rem', color: 'var(--danger-600)', textAlign: 'center' }}>
                            {locationError}
                          </div>
                        )}

                        {!locationLoading && !locationError && locationQuery.trim().length >= 3 && locationSuggestions.length === 0 && (
                          <div style={{ padding: '1rem', fontSize: '0.875rem', color: 'var(--text-secondary)', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                              <div style={{ fontWeight: 600, color: 'var(--gray-700)' }}>No matching location found.</div>
                              <div>Try the business name with city/area, or enter the address and coordinates manually.</div>
                            </div>
                        )}

                        {locationSuggestions.map(s => (
                          <div 
                            key={s.placeId} 
                            onClick={async () => {
                              setLocationQuery(s.primaryText);
                              setShowSuggestions(false);
                              
                              if (s.latitude !== undefined && s.longitude !== undefined) {
                                setFormData({...formData, address: s.displayName, lat: s.latitude, lng: s.longitude, place_id: s.placeId});
                              } else if (locationAutocomplete.getDetails) {
                                setLocationLoading(true);
                                try {
                                  const details = await locationAutocomplete.getDetails(s.placeId, s);
                                  setFormData({
                                    ...formData, 
                                    address: details.formattedAddress || s.displayName, 
                                    lat: details.latitude, 
                                    lng: details.longitude,
                                    place_id: s.placeId
                                  });
                                } catch (err) {
                                  setLocationError('Failed to retrieve location details.');
                                } finally {
                                  setLocationLoading(false);
                                }
                              }
                            }}
                            style={{ padding: '0.625rem 0.75rem', cursor: 'pointer', borderBottom: '1px solid var(--gray-100)', fontSize: '0.875rem', transition: 'background 0.15s' }}
                            onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--gray-50)')}
                            onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                          >
                            <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{s.primaryText}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>{s.secondaryText}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label className="form-label">Address *</label>
                    <textarea required className="form-control" rows={2} value={formData.address || ''} onChange={e => setFormData({...formData, address: e.target.value})} placeholder="Full physical address..." />
                  </div>
                </div>
              </section>

              <section>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, borderBottom: '1px solid var(--gray-200)', paddingBottom: '0.5rem', marginBottom: '1rem' }}>Location & Geofencing</h3>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div>
                      <label className="form-label">Latitude *</label>
                      <input required type="number" step="any" className="form-control" value={formData.lat || ''} onChange={e => setFormData({...formData, lat: e.target.value})} placeholder="-90 to 90" />
                    </div>
                    <div>
                      <label className="form-label">Longitude *</label>
                      <input required type="number" step="any" className="form-control" value={formData.lng || ''} onChange={e => setFormData({...formData, lng: e.target.value})} placeholder="-180 to 180" />
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0.5rem 0' }}>
                    <input type="checkbox" id="geo" checked={formData.geofence !== false} onChange={e => setFormData({...formData, geofence: e.target.checked})} style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
                    <label htmlFor="geo" style={{ fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer' }}>Enable Geofencing</label>
                  </div>

                  {formData.geofence !== false && (
                    <div>
                      <label className="form-label">Geofence Radius (Meters) *</label>
                      <input required type="number" min="1" className="form-control" value={formData.radius || ''} onChange={e => setFormData({...formData, radius: e.target.value})} placeholder="e.g. 200" />
                    </div>
                  )}

                  {/* Location Preview */}
                  <div style={{ marginTop: '1rem', border: '1px solid var(--gray-300)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
                    <div style={{ padding: '0.5rem 1rem', backgroundColor: 'var(--gray-50)', borderBottom: '1px solid var(--gray-200)', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <MapIcon size={14} /> Location Preview
                    </div>
                    <div style={{ backgroundColor: 'var(--bg-surface-elevated)', padding: '1.5rem', textAlign: 'center' }}>
                      {(!formData.address && !formData.lat && !formData.lng) ? (
                        <div style={{ color: 'var(--text-secondary)' }}>No location selected</div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'center' }}>
                          <MapPin size={32} color="var(--primary-600)" style={{ marginBottom: '0.5rem' }} />
                          <div style={{ fontWeight: 600 }}>{formData.address || 'Custom Address'}</div>
                          <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                            Latitude: {formData.lat || 'Not selected'} | Longitude: {formData.lng || 'Not selected'}
                          </div>
                          {formData.geofence !== false && formData.radius > 0 && (
                            <div style={{ fontSize: '0.875rem', color: 'var(--primary-600)', marginTop: '0.25rem' }}>
                              Geofence Radius: {formData.radius}m
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                </div>
              </section>

              <section>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, borderBottom: '1px solid var(--gray-200)', paddingBottom: '0.5rem', marginBottom: '1rem' }}>Status</h3>
                <div>
                  <select className="form-control" value={formData.status || 'Active'} onChange={e => setFormData({...formData, status: e.target.value})}>
                    <option>Active</option>
                    <option>Inactive</option>
                  </select>
                </div>
              </section>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1rem', borderTop: '1px solid var(--gray-200)', paddingTop: '1.5rem' }}>
                <button type="button" onClick={() => setShowForm(false)} className="btn btn-outline">Cancel</button>
                <button type="submit" className="btn btn-primary">{typeof showForm === 'string' ? 'Update Office' : 'Create Office'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Office Detail Drawer */}
      {showDetail && (
        <div className="drawer-overlay" onClick={() => setShowDetail(null)}>
          <div className="drawer wide-drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header" style={{ paddingBottom: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', width: '100%' }}>
                <div>
                  <h2 style={{ fontSize: '1.5rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    {showDetail.name} 
                    <span className="badge badge-gray" style={{ fontFamily: 'monospace' }}>{showDetail.code}</span>
                  </h2>
                  <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '0.5rem', alignItems: 'center' }}>
                    <MapPin size={14} /> {showDetail.address}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <span className={`badge ${showDetail.status === 'Active' ? 'badge-success' : 'badge-gray'}`}>{showDetail.status}</span>
                  <button className="icon-button" onClick={() => setShowDetail(null)}><X size={20} /></button>
                </div>
              </div>
            </div>
            
            <div className="drawer-body" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
              
              {showDetail.status === 'Inactive' && (
                <div style={{ padding: '1rem', backgroundColor: 'var(--gray-100)', color: 'var(--gray-700)', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.875rem' }}>
                  <ShieldAlert size={20} />
                  <div>
                    <strong style={{ display: 'block' }}>Office Inactive</strong>
                    Employees cannot record new office attendance here. Historical attendance is preserved.
                  </div>
                </div>
              )}

              <div className="card" style={{ padding: '1.5rem', border: '1px solid var(--border-color)', boxShadow: 'none' }}>
                <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Navigation size={18} color="var(--primary-600)" /> Geofence Configuration
                </h3>
                
                {showDetail.geofence ? (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
                      <div className="detail-item"><span className="detail-label">Status</span><span className="badge badge-primary" style={{ width: 'fit-content' }}>ENABLED</span></div>
                      <div className="detail-item"><span className="detail-label">Radius</span><span className="detail-value">{showDetail.radius} meters</span></div>
                      <div className="detail-item"><span className="detail-label">Coordinates</span><span className="detail-value" style={{ fontFamily: 'monospace' }}>{showDetail.lat}, {showDetail.lng}</span></div>
                    </div>
                    
                    <div style={{ backgroundColor: 'var(--gray-50)', borderRadius: 'var(--radius-md)', padding: '2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', border: '1px dashed var(--gray-300)' }}>
                      <div style={{ position: 'relative', width: '150px', height: '150px', borderRadius: '50%', border: '2px solid var(--primary-500)', backgroundColor: 'rgba(59, 130, 246, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div style={{ position: 'absolute', top: '-25px', color: 'var(--primary-700)', fontSize: '0.75rem', fontWeight: 600 }}>{showDetail.radius}m Radius</div>
                        <MapPin size={32} color="var(--danger-600)" fill="white" strokeWidth={2} />
                      </div>
                      <div style={{ marginTop: '1rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Clock-in requires employee to be within the circle.</div>
                    </div>
                  </>
                ) : (
                  <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)', backgroundColor: 'var(--gray-50)', borderRadius: 'var(--radius-md)' }}>
                    Geofencing is currently disabled for this office location.
                  </div>
                )}
              </div>

              <div>
                <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  Employees Assigned to this Office
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <span className="badge badge-primary">{showDetail.employees} Total</span>
                    <button onClick={() => setAssignModal(showDetail)} className="btn btn-outline" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}><UserPlus size={14}/> Assign</button>
                  </div>
                </h3>
                
                {showDetail.employees > 0 ? (
                  <div className="table-container" style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)' }}>
                    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                      Employees view will be implemented using real data.
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)', border: '1px dashed var(--gray-300)', borderRadius: 'var(--radius-md)' }}>
                    No employees currently assigned to this office.
                  </div>
                )}
              </div>

            </div>
          </div>
        </div>
      )}

      {/* Assign Employees Modal */}
      {assignModal && (
        <div className="drawer-overlay" style={{ alignItems: 'center' }}>
          <div className="card" style={{ margin: 'auto', width: '100%', maxWidth: '450px', animation: 'slideUp 0.3s' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>Assign Employees</h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>Select employees to assign to <strong>{assignModal.name}</strong>.</p>
            
            <form onSubmit={handleAssignSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ position: 'relative' }}>
                <Search size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
                <input type="text" className="form-control" placeholder="Search employees..." style={{ paddingLeft: '2.25rem' }} />
              </div>
              
              <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', maxHeight: '200px', overflowY: 'auto' }}>
                {[
                  { id: 'EMP044', name: 'Vivek Sharma', dept: 'Marketing' },
                  { id: 'EMP045', name: 'Kavitha N', dept: 'Sales' },
                  { id: 'EMP046', name: 'John Doe', dept: 'Development' }
                ].map(emp => (
                  <label key={emp.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem', borderBottom: '1px solid var(--border-color)', cursor: 'pointer' }}>
                    <input type="checkbox" style={{ width: '16px', height: '16px' }} />
                    <div>
                      <div style={{ fontWeight: 500, fontSize: '0.875rem' }}>{emp.name} ({emp.id})</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{emp.dept}</div>
                    </div>
                  </label>
                ))}
              </div>

              <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                <button type="button" onClick={() => setAssignModal(null)} className="btn btn-outline" style={{ flex: 1 }}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>Assign Selected</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Geofence Simulator */}
      {testGeofenceModal && (
        <div className="drawer-overlay" style={{ alignItems: 'center' }}>
          <div className="card" style={{ margin: 'auto', width: '100%', maxWidth: '500px', animation: 'slideUp 0.3s' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Crosshair size={20} color="var(--primary-600)" /> Geofence Simulator
              </div>
              <button className="icon-button" onClick={() => setTestGeofenceModal(null)}><X size={18}/></button>
            </h3>
            
            <div style={{ backgroundColor: 'var(--gray-50)', padding: '1rem', borderRadius: 'var(--radius-md)', marginBottom: '1.5rem', fontSize: '0.875rem', border: '1px solid var(--border-color)' }}>
              <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Office Center: <span style={{ fontWeight: 'normal', fontFamily: 'monospace' }}>{testGeofenceModal.lat}, {testGeofenceModal.lng}</span></div>
              <div style={{ fontWeight: 600 }}>Radius: <span style={{ fontWeight: 'normal' }}>{testGeofenceModal.radius}m</span></div>
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Simulated Employee Distance from Office</span>
                <span style={{ fontWeight: 700, color: 'var(--primary-700)' }}>{simDistance}m</span>
              </label>
              <input 
                type="range" 
                min="0" 
                max={testGeofenceModal.radius * 2 + 100} 
                value={simDistance}
                onChange={e => setSimDistance(parseInt(e.target.value))}
                style={{ width: '100%', cursor: 'pointer' }}
              />
            </div>

            <div style={{ padding: '1.5rem', borderRadius: 'var(--radius-md)', textAlign: 'center', border: `2px solid ${simDistance <= testGeofenceModal.radius ? 'var(--success)' : 'var(--danger)'}`, backgroundColor: simDistance <= testGeofenceModal.radius ? 'var(--success-50)' : 'var(--danger-50)' }}>
              {simDistance <= testGeofenceModal.radius ? (
                <>
                  <CheckCircle2 size={32} color="var(--success-600)" style={{ margin: '0 auto 0.5rem auto' }} />
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--success)' }}>INSIDE GEOFENCE</div>
                  <div style={{ fontSize: '0.875rem', color: 'var(--success-800)', marginTop: '0.25rem' }}>Clock In Allowed</div>
                </>
              ) : (
                <>
                  <AlertTriangle size={32} color="var(--danger-600)" style={{ margin: '0 auto 0.5rem auto' }} />
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--danger)' }}>OUTSIDE GEOFENCE</div>
                  <div style={{ fontSize: '0.875rem', color: 'var(--danger-800)', marginTop: '0.25rem' }}>Clock In Blocked</div>
                </>
              )}
            </div>

            <div style={{ marginTop: '1.5rem', padding: '1rem', backgroundColor: 'var(--gray-100)', borderRadius: 'var(--radius-md)', fontSize: '0.75rem', color: 'var(--text-secondary)', borderLeft: '3px solid var(--primary-500)' }}>
              <strong style={{ display: 'block', color: 'var(--text-primary)', marginBottom: '0.25rem' }}>Note on WFH (Work From Home)</strong>
              WFH mode does not require office geofencing. Employees scheduled for WFH bypass this location check, but still follow assigned shift timings and break rules.
            </div>

          </div>
        </div>
      )}


      <style>{`
        
        
        
        
        
        
        .summary-card-small:hover { transform: translateY(-2px); box-shadow: var(--shadow-sm); }
        
        
        
        
        
        .dropdown-menu { background: white; border: 1px solid var(--border-color); border-radius: var(--radius-md); box-shadow: var(--shadow-lg); padding: 0.5rem 0; min-width: 160px; }
        .dropdown-item { width: 100%; text-align: left; padding: 0.5rem 1rem; font-size: 0.875rem; display: flex; align-items: center; gap: 0.5rem; background: none; border: none; cursor: pointer; color: var(--gray-700); }
        .dropdown-item:hover { background-color: var(--gray-50); color: var(--gray-900); }
        
        .drawer-overlay { position: fixed; inset: 0; background-color: rgba(0,0,0,0.4); z-index: 100; display: flex; justify-content: flex-end; }
        .drawer { background-color: var(--bg-surface); width: 100%; height: 100%; display: flex; flex-direction: column; box-shadow: var(--shadow-xl); animation: slideInRight 0.3s forwards; }
        .wide-drawer { max-width: min(520px, 100vw); }
        .drawer-header { padding: 1.5rem; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; alignItems: center; }
        .drawer-body { padding: 1.5rem; overflow-y: auto; flex: 1; }
        
        .detail-item { display: flex; flex-direction: column; gap: 0.25rem; }
        .detail-label { font-size: 0.75rem; color: var(--gray-500); }
        .detail-value { font-size: 0.875rem; font-weight: 500; color: var(--gray-900); }
        
        @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes slideDown { from { transform: translate(-50%, -100%); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }
        
        @media (max-width: 768px) {
          .drawer-overlay { align-items: flex-end; }
          .drawer, .wide-drawer { height: 95vh; border-top-left-radius: var(--radius-xl); border-top-right-radius: var(--radius-xl); animation: slideUp 0.3s forwards; }
        }
        
        .skeleton { background: linear-gradient(90deg, var(--gray-200) 25%, var(--gray-100) 50%, var(--gray-200) 75%); background-size: 200% 100%; animation: skeleton-loading 1.5s infinite; }
        @keyframes skeleton-loading { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
      `}</style>
    </div>
  );
};

export default AdminOffices;



