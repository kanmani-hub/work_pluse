/// <reference types="@types/google.maps" />
// LEGACY: Google Maps renderer, no longer used by Live Tracking (replaced by components/tracking/LeafletLiveMap.tsx).
// Kept until the Leaflet map is verified in the browser; safe to delete together with services/maps/googleMapsLoader.ts.
import React, { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps } from '../../services/maps/googleMapsLoader';

type EmployeeStatus = 'Working' | 'On Break' | 'WFH' | 'Outside Geofence' | 'Location Unavailable' | 'Offline' | 'Clocked Out';

interface LiveEmployee {
  id: string;
  empId: string;
  name: string;
  department: string;
  status: EmployeeStatus;
  locationStatus: string;
  distance: string;
  lastUpdated: string;
  office: string;
  officeRadius: number | null;
  lat: number | null;
  lng: number | null;
}

interface Office {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  geofence_radius?: number | null; // offices.geofence_radius (actual column)
  geofence_radius_meters?: number;
}

interface LiveTrackingMapProps {
  employees: LiveEmployee[];
  office: Office | null;
  selectedEmpId?: string | null;
}

export const LiveTrackingMap: React.FC<LiveTrackingMapProps> = ({ employees, office, selectedEmpId }) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  
  const officeMarkerRef = useRef<google.maps.Marker | null>(null);
  const officeCircleRef = useRef<google.maps.Circle | null>(null);
  const employeeMarkersRef = useRef<{ [key: string]: google.maps.Marker }>({});
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);

  useEffect(() => {
    const initMap = async () => {
      const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
      if (!apiKey) {
        setMapError("VITE_GOOGLE_MAPS_API_KEY is missing.");
        return;
      }
      
      try {
        const { Map } = await loadGoogleMaps();
        
        if (mapRef.current && !map) {
          const mapInstance = new Map(mapRef.current, {
            center: { lat: 0, lng: 0 },
            zoom: 2,
            mapTypeControl: false,
            streetViewControl: false,
          });
          setMap(mapInstance);
          infoWindowRef.current = new google.maps.InfoWindow();
        }
      } catch (err: any) {
        console.error("Google Maps failed to load:", err);
        setMapError(err?.message || "Failed to load Google Maps");
      }
    };
    initMap();
  }, [map]);

  const getMarkerColor = (emp: LiveEmployee) => {
    if (emp.status === 'Outside Geofence') return '#f43f5e'; // red
    if (emp.status === 'WFH') return '#8b5cf6'; // purple
    if (emp.locationStatus === 'STALE / LAST KNOWN') return '#64748b'; // gray
    return '#10b981'; // green
  };

  useEffect(() => {
    if (!map) return;
    
    const bounds = new google.maps.LatLngBounds();
    let hasValidPoints = false;

    // 1. Office marker & circle
    if (office && office.latitude && office.longitude) {
      const officePos = { lat: office.latitude, lng: office.longitude };
      hasValidPoints = true;
      bounds.extend(officePos);

      if (!officeMarkerRef.current) {
        officeMarkerRef.current = new google.maps.Marker({
          map,
          position: officePos,
          title: office.name,
          label: { text: '🏢', fontSize: '20px' },
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 14,
            fillColor: '#1e293b',
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 2,
          }
        });
      } else {
        officeMarkerRef.current.setPosition(officePos);
      }

      if (!officeCircleRef.current) {
        officeCircleRef.current = new google.maps.Circle({
          map,
          center: officePos,
          radius: office.geofence_radius ?? office.geofence_radius_meters ?? 0,
          strokeColor: "#38e8ff",
          strokeOpacity: 0.8,
          strokeWeight: 2,
          fillColor: "#38e8ff",
          fillOpacity: 0.1,
        });
      } else {
        officeCircleRef.current.setCenter(officePos);
        officeCircleRef.current.setRadius(office.geofence_radius ?? office.geofence_radius_meters ?? 0);
      }
    } else {
      if (officeMarkerRef.current) {
        officeMarkerRef.current.setMap(null);
        officeMarkerRef.current = null;
      }
      if (officeCircleRef.current) {
        officeCircleRef.current.setMap(null);
        officeCircleRef.current = null;
      }
    }

    // 2. Employee markers
    const currentEmpIds = new Set<string>();
    
    employees.forEach(emp => {
      if (emp.lat == null || emp.lng == null || emp.status === 'Location Unavailable') return;
      
      currentEmpIds.add(emp.id);
      const pos = { lat: emp.lat, lng: emp.lng };
      hasValidPoints = true;
      if (!selectedEmpId) bounds.extend(pos);

      let marker = employeeMarkersRef.current[emp.id];
      const color = getMarkerColor(emp);
      
      if (!marker) {
        marker = new google.maps.Marker({
          map,
          position: pos,
          title: emp.name,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 8,
            fillColor: color,
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 2,
          }
        });
        
        marker.addListener('click', () => {
          const content = `
            <div style="padding: 4px; min-width: 200px; color: #1e293b;">
              <h3 style="margin: 0 0 4px 0; font-size: 14px; font-weight: 600;">${emp.name}</h3>
              <div style="font-size: 12px; margin-bottom: 8px; color: #64748b;">${emp.empId} • ${emp.department}</div>
              <div style="font-size: 12px; margin-bottom: 4px;"><strong>Office:</strong> ${emp.office}</div>
              <div style="font-size: 12px; margin-bottom: 4px;"><strong>Work Status:</strong> ${emp.status}</div>
              <div style="font-size: 12px; margin-bottom: 4px;"><strong>Location:</strong> ${emp.locationStatus}</div>
              <div style="font-size: 12px; margin-bottom: 4px;"><strong>Lat/Lng:</strong> ${emp.lat?.toFixed(5)}, ${emp.lng?.toFixed(5)}</div>
              <div style="font-size: 12px; margin-bottom: 4px;"><strong>Distance:</strong> ${emp.distance}</div>
              <div style="font-size: 12px; color: #64748b;"><em>Last Updated: ${emp.lastUpdated}</em></div>
            </div>
          `;
          if (infoWindowRef.current) {
            infoWindowRef.current.setContent(content);
            infoWindowRef.current.open(map, marker);
          }
        });
        
        employeeMarkersRef.current[emp.id] = marker;
      } else {
        marker.setPosition(pos);
        marker.setIcon({
          path: google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: color,
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2,
        });
      }
    });

    // Cleanup removed employees
    Object.keys(employeeMarkersRef.current).forEach(id => {
      if (!currentEmpIds.has(id)) {
        employeeMarkersRef.current[id].setMap(null);
        delete employeeMarkersRef.current[id];
      }
    });

    // Auto Fit or Pan
    if (selectedEmpId) {
      const selectedEmp = employees.find(e => e.id === selectedEmpId);
      if (selectedEmp && selectedEmp.lat != null && selectedEmp.lng != null) {
        map.panTo({ lat: selectedEmp.lat, lng: selectedEmp.lng });
        map.setZoom(16);
      }
    } else if (hasValidPoints) {
      map.fitBounds(bounds, { top: 40, bottom: 40, left: 40, right: 40 });
    } else if (!hasValidPoints && officeMarkerRef.current === null) {
      // no office, no valid emps, reset to global or something
      map.setZoom(2);
    }
  }, [map, employees, office, selectedEmpId]);

  if (mapError) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc', color: '#ef4444', padding: '2rem', textAlign: 'center' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.5rem' }}>Unable to load Google Maps</h3>
        <p style={{ fontSize: '0.875rem' }}>{mapError}</p>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {!map && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc', color: '#64748b', zIndex: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div className="spinner" style={{ width: '1rem', height: '1rem', border: '2px solid currentColor', borderRightColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
            Loading Google Maps...
          </div>
        </div>
      )}
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
};
