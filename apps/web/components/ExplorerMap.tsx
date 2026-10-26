'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect } from 'react';
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
} from 'react-leaflet';
import L from 'leaflet';

export interface GraphNode {
  key: string;
  name: string;
  lat: number;
  lng: number;
  linkCount: number;
  availableCount: number;
}

export interface GraphEdge {
  a: string;
  b: string;
  linkCount: number;
  availableCount: number;
  availableMbps: number;
  minPrice: number | null;
  currency: string;
  bestLatencyMs: number | null;
  hot: boolean;
  trendPct: number;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function FitNodes({ nodes }: { nodes: GraphNode[] }) {
  const map = useMap();
  const sig = nodes.map((n) => n.key).join('|');
  useEffect(() => {
    const t = setTimeout(() => {
      map.invalidateSize();
      if (nodes.length) {
        map.fitBounds(L.latLngBounds(nodes.map((n) => [n.lat, n.lng] as [number, number])), {
          padding: [50, 50],
          maxZoom: 7,
          animate: false,
        });
      }
    }, 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line
  }, [sig, map]);
  return null;
}

export default function ExplorerMap({
  nodes,
  edges,
  aKey,
  zKey,
  highlight,
  onPick,
  labels,
  height,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  aKey: string | null;
  zKey: string | null;
  highlight: string[] | null;
  onPick: (key: string) => void;
  labels: {
    hot: string;
    edge: (e: GraphEdge, a: string, b: string) => string;
    node: (n: GraphNode) => string;
  };
  height: number | string;
}) {
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const hl = new Set<string>();
  if (highlight)
    for (let i = 1; i < highlight.length; i++)
      hl.add([highlight[i - 1], highlight[i]].sort().join('|'));

  return (
    <MapContainer
      center={[-2.5, 118]}
      zoom={5}
      scrollWheelZoom
      style={{ height, width: '100%', borderRadius: 12 }}
      aria-label="Indonesia network map"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {edges.map((e) => {
        const a = byKey.get(e.a);
        const b = byKey.get(e.b);
        if (!a || !b) return null;
        const key = [e.a, e.b].sort().join('|');
        const selected = hl.has(key);
        const dim = highlight && !selected;
        const available = e.availableCount > 0;
        return (
          <Polyline
            key={key}
            positions={[
              [a.lat, a.lng],
              [b.lat, b.lng],
            ]}
            pathOptions={{
              color: selected ? '#34d399' : e.hot ? '#fbbf24' : available ? '#38bdf8' : '#64748b',
              weight: selected ? 6 : (e.hot ? 5 : 2) + Math.min(e.linkCount, 3),
              opacity: dim ? 0.2 : 0.9,
              dashArray: available ? undefined : '6 6',
            }}
          >
            <Tooltip sticky>{labels.edge(e, a.name, b.name)}</Tooltip>
          </Polyline>
        );
      })}
      {edges
        .filter((e) => e.hot)
        .map((e) => {
          const a = byKey.get(e.a);
          const b = byKey.get(e.b);
          if (!a || !b) return null;
          return (
            <Marker
              key={`hot-${e.a}-${e.b}`}
              position={[(a.lat + b.lat) / 2, (a.lng + b.lng) / 2]}
              interactive={false}
              icon={L.divIcon({
                className: '',
                html: `<span style="background:#f59e0b;color:#111827;font-weight:700;font-size:11px;padding:2px 6px;border-radius:999px;white-space:nowrap">&#128293; ${escapeHtml(labels.hot)}</span>`,
              })}
            />
          );
        })}
      {nodes.map((n) => {
        const isA = n.key === aKey;
        const isZ = n.key === zKey;
        const open = n.availableCount > 0;
        return (
          <CircleMarker
            key={n.key}
            center={[n.lat, n.lng]}
            radius={6 + Math.min(n.linkCount, 6) + (isA || isZ ? 4 : 0)}
            pathOptions={{
              color: isA ? '#34d399' : isZ ? '#a78bfa' : '#f8fafc',
              weight: isA || isZ ? 4 : 2,
              fillColor: isA ? '#34d399' : isZ ? '#a78bfa' : '#38bdf8',
              fillOpacity: open || isA || isZ ? 0.95 : 0,
            }}
            eventHandlers={{ click: () => onPick(n.key) }}
          >
            <Tooltip permanent={isA || isZ} direction="top" offset={[0, -6]}>
              {isA ? 'A: ' : isZ ? 'Z: ' : ''}
              {labels.node(n)}
            </Tooltip>
          </CircleMarker>
        );
      })}
      <FitNodes nodes={nodes} />
    </MapContainer>
  );
}
