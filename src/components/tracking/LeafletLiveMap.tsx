import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/**
 * Live Tracking map rendering layer (Leaflet + OpenStreetMap).
 *
 * Rendering ONLY: every value shown here (employee positions, work status,
 * location state, distance, office, geofence radius) is computed elsewhere by the
 * existing Live Tracking rules and passed in as props. This component never
 * classifies an employee as in office / outside / stale; the geofence circle is a
 * visual of the configured radius, not a second geofence calculation.
 */

type EmployeeStatus = 'Working' | 'On Break' | 'WFH' | 'Outside Geofence' | 'Location Unavailable' | 'Offline' | 'Clocked Out';

export interface LeafletLiveEmployee {
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

export interface LeafletLiveOffice {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  geofence_radius?: number | null; // offices.geofence_radius (actual column)
  geofence_radius_meters?: number;
}

interface LeafletLiveMapProps {
  employees: LeafletLiveEmployee[];
  office: LeafletLiveOffice | null | undefined;
  selectedEmpId?: string | null;
}

const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';

// Used ONLY when no office record is available from Supabase (Whitee Lotus).
const FALLBACK_OFFICE_CENTER: L.LatLngTuple = [13.052815, 80.200211];

// Same label the existing Live Tracking rules produce for stale GPS (> LIVE_STALE_MINUTES).
const STALE_LABEL = 'STALE / LAST KNOWN';

const escapeHtml = (value: unknown): string =>
  String(value ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string
  ));

const isStale = (emp: LeafletLiveEmployee) => emp.locationStatus === STALE_LABEL;

// Same colours as the previous map and the page legend. A stale fix is always grey
// ("Last Known"), so a last-known point is never drawn as in-office green or outside red.
const markerColor = (emp: LeafletLiveEmployee): string => {
  if (isStale(emp)) return '#64748b';
  if (emp.status === 'Outside Geofence') return '#f43f5e';
  if (emp.status === 'WFH') return '#8b5cf6';
  return '#10b981';
};

const popupHtml = (emp: LeafletLiveEmployee): string => `
  <div style="padding: 2px; min-width: 200px; color: #1e293b;">
    <h3 style="margin: 0 0 4px 0; font-size: 14px; font-weight: 600;">${escapeHtml(emp.name)}</h3>
    <div style="font-size: 12px; margin-bottom: 8px; color: #64748b;">${escapeHtml(emp.empId)} &bull; ${escapeHtml(emp.department)}</div>
    ${isStale(emp) ? '<div style="font-size: 11px; font-weight: 600; margin-bottom: 6px; color: #475569; background: #e2e8f0; border-radius: 4px; padding: 2px 6px; display: inline-block;">Last known location (GPS stale)</div>' : ''}
    <div style="font-size: 12px; margin-bottom: 4px;"><strong>Office:</strong> ${escapeHtml(emp.office)}</div>
    <div style="font-size: 12px; margin-bottom: 4px;"><strong>Work Status:</strong> ${escapeHtml(emp.status)}</div>
    <div style="font-size: 12px; margin-bottom: 4px;"><strong>Location:</strong> ${escapeHtml(emp.locationStatus)}</div>
    <div style="font-size: 12px; margin-bottom: 4px;"><strong>Lat/Lng:</strong> ${emp.lat?.toFixed(5)}, ${emp.lng?.toFixed(5)}</div>
    <div style="font-size: 12px; margin-bottom: 4px;"><strong>Distance:</strong> ${escapeHtml(emp.distance)}</div>
    <div style="font-size: 12px; color: #64748b;"><em>Last Updated: ${escapeHtml(emp.lastUpdated)}</em></div>
  </div>
`;

const officeIcon = L.divIcon({
  className: 'lt-office-marker',
  html: '<div style="width:28px;height:28px;border-radius:50%;background:#1e293b;border:2px solid #ffffff;display:flex;align-items:center;justify-content:center;font-size:15px;line-height:1;box-shadow:0 1px 4px rgba(0,0,0,.35);">🏢</div>',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
  popupAnchor: [0, -14],
});

const LeafletLiveMap: React.FC<LeafletLiveMapProps> = ({ employees, office, selectedEmpId }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  const officeLayerRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef<Record<string, L.CircleMarker>>({});
  const lastSelectedRef = useRef<string | null | undefined>(undefined);

  // 1. Create the map once; tear it down on unmount.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    try {
      const map = L.map(containerRef.current, {
        center: FALLBACK_OFFICE_CENTER,
        zoom: 15,
        zoomControl: true,
        attributionControl: true,
      });
      L.tileLayer(OSM_TILE_URL, { maxZoom: 19, attribution: OSM_ATTRIBUTION }).addTo(map);
      officeLayerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      setReady(true);

      // The container is sized by a flex/grid layout; keep Leaflet in sync with it.
      const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => map.invalidateSize()) : null;
      ro?.observe(containerRef.current);
      const t = window.setTimeout(() => map.invalidateSize(), 0);

      return () => {
        window.clearTimeout(t);
        ro?.disconnect();
        map.remove();
        mapRef.current = null;
        officeLayerRef.current = null;
        markersRef.current = {};
        lastSelectedRef.current = undefined;
      };
    } catch (err: any) {
      console.error('Leaflet map failed to initialise:', err);
      setMapError(err?.message || 'Failed to initialise the map');
    }
  }, []);

  // 2. Draw office, geofence and employees from the props; fit or pan.
  useEffect(() => {
    const map = mapRef.current;
    const officeLayer = officeLayerRef.current;
    if (!ready || !map || !officeLayer) return;

    const boundsPoints: L.LatLngExpression[] = [];

    // Office marker + geofence circle (visual only, radius from the office record).
    officeLayer.clearLayers();
    const hasOfficeCoords = !!office && office.latitude != null && office.longitude != null;
    const officeCenter: L.LatLngTuple = hasOfficeCoords
      ? [Number(office!.latitude), Number(office!.longitude)]
      : FALLBACK_OFFICE_CENTER;

    L.marker(officeCenter, { icon: officeIcon, title: hasOfficeCoords ? office!.name : 'Office (fallback location)', keyboard: false })
      .bindPopup(`<strong>${escapeHtml(hasOfficeCoords ? office!.name : 'Whitee Lotus')}</strong>${hasOfficeCoords ? '' : '<br/><span style="font-size:11px;color:#64748b;">Office record unavailable – showing default location</span>'}`)
      .addTo(officeLayer);

    if (hasOfficeCoords) {
      boundsPoints.push(officeCenter);
      const radius = office!.geofence_radius ?? office!.geofence_radius_meters ?? 0;
      if (radius > 0) {
        L.circle(officeCenter, {
          radius,
          color: '#38e8ff',
          opacity: 0.8,
          weight: 2,
          fillColor: '#38e8ff',
          fillOpacity: 0.1,
          interactive: false,
        }).addTo(officeLayer);
      }
    }

    // Employee markers: real coordinates only; no position is ever invented.
    const seen = new Set<string>();
    employees.forEach(emp => {
      if (emp.lat == null || emp.lng == null || emp.status === 'Location Unavailable') return;
      seen.add(emp.id);
      const pos: L.LatLngTuple = [emp.lat, emp.lng];
      if (!selectedEmpId) boundsPoints.push(pos);

      const style: L.CircleMarkerOptions = {
        radius: 8,
        color: '#ffffff',
        weight: 2,
        fillColor: markerColor(emp),
        fillOpacity: isStale(emp) ? 0.7 : 1,
        dashArray: isStale(emp) ? '3 3' : undefined,
      };

      let marker = markersRef.current[emp.id];
      if (!marker) {
        marker = L.circleMarker(pos, style).addTo(map);
        markersRef.current[emp.id] = marker;
      } else {
        marker.setLatLng(pos);
        marker.setStyle(style);
      }
      marker.unbindTooltip();
      marker.bindTooltip(`${emp.name}${isStale(emp) ? ' (last known)' : ''}`, { direction: 'top', offset: [0, -8] });
      // Re-binding keeps an open popup's content current after realtime updates.
      if (marker.getPopup()) marker.setPopupContent(popupHtml(emp));
      else marker.bindPopup(popupHtml(emp), { minWidth: 200 });
    });

    Object.keys(markersRef.current).forEach(id => {
      if (!seen.has(id)) {
        markersRef.current[id].remove();
        delete markersRef.current[id];
      }
    });

    // Fit / pan – same behaviour as before: selected employee → pan + zoom 16, otherwise fit everything.
    if (selectedEmpId) {
      const sel = employees.find(e => e.id === selectedEmpId);
      if (sel && sel.lat != null && sel.lng != null) {
        map.setView([sel.lat, sel.lng], 16);
        if (lastSelectedRef.current !== selectedEmpId) markersRef.current[sel.id]?.openPopup();
      }
    } else if (boundsPoints.length > 0) {
      map.fitBounds(L.latLngBounds(boundsPoints), { padding: [40, 40], maxZoom: 17 });
    } else {
      map.setView(FALLBACK_OFFICE_CENTER, 15);
    }
    lastSelectedRef.current = selectedEmpId;
  }, [ready, employees, office, selectedEmpId]);

  if (mapError) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc', color: '#ef4444', padding: '2rem', textAlign: 'center' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.5rem' }}>Unable to load map</h3>
        <p style={{ fontSize: '0.875rem' }}>{mapError}</p>
      </div>
    );
  }

  // position:absolute + inset:0 fills the existing map box (which is position:relative, minHeight 400px);
  // zIndex 0 creates a stacking context so Leaflet panes never sit above the page's drawer or modals.
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} aria-label="Live tracking map" />
    </div>
  );
};

export default LeafletLiveMap;
