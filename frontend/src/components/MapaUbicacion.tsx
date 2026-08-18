import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import { useT } from "../i18n";

// Icono por defecto de Leaflet (los assets se resuelven con el bundler, sin CDN).
const icono = L.icon({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

interface Props {
  lat: number | null;
  lng: number | null;
  onChange: (lat: number, lng: number) => void;
}

/**
 * Mapa interactivo para fijar la ubicación de un negocio con un pin (clic o arrastre),
 * o buscando por dirección (geocodificación con Nominatim/OpenStreetMap).
 * NO usa el GPS del dispositivo automáticamente: el usuario coloca el punto a mano.
 */
export function MapaUbicacion({ lat, lng, onChange }: Props) {
  const { t } = useT();
  const contRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const cbRef = useRef(onChange);
  cbRef.current = onChange;

  const [buscar, setBuscar] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [aviso, setAviso] = useState("");

  // Inicializa el mapa una sola vez.
  useEffect(() => {
    if (!contRef.current || mapRef.current) return;
    const tienePunto = lat != null && lng != null;
    const inicio: [number, number] = tienePunto ? [lat!, lng!] : [20, 0]; // vista mundial neutral
    const map = L.map(contRef.current, { scrollWheelZoom: false }).setView(inicio, tienePunto ? 15 : 2);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap",
      maxZoom: 19,
    }).addTo(map);

    // Coloca/mueve el pin al hacer clic en el mapa.
    map.on("click", (e: L.LeafletMouseEvent) => ponerPin(e.latlng.lat, e.latlng.lng, false));

    if (tienePunto) crearMarker(map, lat!, lng!);
    mapRef.current = map;

    // El contenedor puede montarse con tamaño 0 (dentro de tarjetas); recalcula tras un tick.
    setTimeout(() => map.invalidateSize(), 100);

    return () => { map.remove(); mapRef.current = null; markerRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function crearMarker(map: L.Map, la: number, ln: number) {
    const m = L.marker([la, ln], { draggable: true, icon: icono }).addTo(map);
    m.on("dragend", () => { const p = m.getLatLng(); cbRef.current(p.lat, p.lng); });
    markerRef.current = m;
  }

  function ponerPin(la: number, ln: number, centrar: boolean) {
    const map = mapRef.current;
    if (!map) return;
    if (markerRef.current) markerRef.current.setLatLng([la, ln]);
    else crearMarker(map, la, ln);
    if (centrar) map.setView([la, ln], Math.max(map.getZoom(), 15));
    cbRef.current(la, ln);
  }

  // Cuando cambian las coords desde fuera (p. ej. botón GPS opcional del padre), refleja el pin.
  useEffect(() => {
    if (!mapRef.current || lat == null || lng == null) return;
    if (markerRef.current) markerRef.current.setLatLng([lat, lng]);
    else crearMarker(mapRef.current, lat, lng);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng]);

  // Geocodifica la dirección escrita y mueve el pin (OpenStreetMap Nominatim, gratis).
  async function geocodificar() {
    const q = buscar.trim();
    if (!q) return;
    setBuscando(true); setAviso("");
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      const data: { lat: string; lon: string }[] = await res.json();
      if (!data.length) { setAviso(t("map.notFound")); return; }
      ponerPin(Number(data[0].lat), Number(data[0].lon), true);
    } catch {
      setAviso(t("map.searchError"));
    } finally {
      setBuscando(false);
    }
  }

  return (
    <div style={{ marginTop: 10 }}>
      <div className="row" style={{ gap: 8 }}>
        <input
          placeholder={t("map.searchPlaceholder")}
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); geocodificar(); } }}
          style={{ flex: 1 }}
        />
        <button type="button" className="ghost" onClick={geocodificar} disabled={buscando}>
          {buscando ? t("map.searching") : `🔎 ${t("map.search")}`}
        </button>
      </div>
      <p className="muted small" style={{ margin: "6px 0" }}>{t("map.help")}</p>
      {aviso && <p className="error small">{aviso}</p>}
      <div ref={contRef} style={{ height: 280, borderRadius: 12, overflow: "hidden", border: "1px solid var(--border)" }} />
      {lat != null && lng != null && (
        <p className="muted small" style={{ marginTop: 6 }}>📍 {lat.toFixed(5)}, {lng.toFixed(5)}</p>
      )}
    </div>
  );
}
