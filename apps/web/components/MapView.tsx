'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect } from 'react';
import {
  CircleMarker,
  GeoJSON,
  MapContainer,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from 'react-leaflet';
import L from 'leaflet';

export interface MapMarker {
  lat: number;
  lng: number;
  label: string;
}

export interface MapRoute {
  id: string;
  geojson: GeoJSON.FeatureCollection;
  color?: string;
  label?: string;
}

function Fit({ routes, markers }: { routes: MapRoute[]; markers: MapMarker[] }) {
  const map = useMap();
  // Re-fit only when the set of routes/markers changes, not on every parent render.
  const signature =
    routes.map((r) => `${r.id}:${r.geojson.features.length}`).join('|') +
    markers.map((m) => `${m.lat},${m.lng}`).join('|');
  useEffect(() => {
    const bounds = L.latLngBounds([]);
    routes.forEach((r) => {
      if (r.geojson.features.length) bounds.extend(L.geoJSON(r.geojson).getBounds());
    });
    markers.forEach((m) => bounds.extend([m.lat, m.lng]));
    const timer = setTimeout(() => {
      map.invalidateSize();
      if (bounds.isValid())
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 9, animate: false });
    }, 50);
    return () => clearTimeout(timer);
  }, [signature, map]);
  return null;
}

export default function MapView({
  routes,
  markers = [],
  height = 420,
}: {
  routes: MapRoute[];
  markers?: MapMarker[];
  height?: number;
}) {
  return (
    <MapContainer
      center={[-2.5, 118]}
      zoom={5}
      scrollWheelZoom
      style={{ height, width: '100%', borderRadius: 12 }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {routes.map((r) => (
        <GeoJSON
          key={r.id + r.geojson.features.length}
          data={r.geojson}
          style={{ color: r.color ?? '#38bdf8', weight: 4, opacity: 0.9 }}
          onEachFeature={(f, layer) => {
            const name = (f.properties?.name as string) || r.label;
            // Leaflet parses string tooltips as HTML; KML placemark names are operator-controlled, so pass a text node.
            if (name) {
              const el = document.createElement('span');
              el.textContent = String(name);
              layer.bindTooltip(el, { sticky: true });
            }
          }}
        />
      ))}
      {markers.map((m) => (
        <CircleMarker
          key={`${m.lat},${m.lng},${m.label}`}
          center={[m.lat, m.lng]}
          radius={7}
          pathOptions={{ color: '#f8fafc', fillColor: '#2563eb', fillOpacity: 1 }}
        >
          <Tooltip permanent direction="top" offset={[0, -6]}>
            {m.label}
          </Tooltip>
          <Popup>{m.label}</Popup>
        </CircleMarker>
      ))}
      <Fit routes={routes} markers={markers} />
    </MapContainer>
  );
}
