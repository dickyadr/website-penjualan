import { useEffect, useRef, useState } from 'react'

export type MapPoint = { lat: number; lng: number; label: string }

const JAKARTA: MapPoint = { lat: -6.2088, lng: 106.8456, label: 'Jakarta' }
const googleKey = import.meta.env.VITE_GOOGLE_MAPS_KEY as string | undefined

declare global {
  interface Window {
    google?: {
      maps: {
        Map: new (el: HTMLElement, opts: object) => GoogleMap
        Marker: new (opts: object) => GoogleMarker
        Geocoder: new () => { geocode: (req: object, cb: (results: { formatted_address?: string }[] | null, status: string) => void) => void }
        event: { clearInstanceListeners: (item: object) => void }
      }
    }
    L?: LeafletNS
  }
}

type GoogleMap = {
  setCenter: (pos: { lat: number; lng: number }) => void
  addListener: (name: string, cb: (e: { latLng: { lat: () => number; lng: () => number } }) => void) => void
}
type GoogleMarker = {
  setPosition: (pos: { lat: number; lng: number }) => void
  addListener: (name: string, cb: () => void) => void
  getPosition: () => { lat: () => number; lng: () => number } | null
}
type LeafletNS = {
  map: (el: HTMLElement, opts: object) => LeafletMap
  tileLayer: (url: string, opts: object) => { addTo: (map: LeafletMap) => unknown }
  marker: (latlng: [number, number], opts?: object) => LeafletMarker
}
type LeafletMap = {
  setView: (latlng: [number, number], zoom: number) => LeafletMap
  on: (name: string, cb: (e: { latlng: { lat: number; lng: number } }) => void) => void
  remove: () => void
}
type LeafletMarker = {
  addTo: (map: LeafletMap) => LeafletMarker
  setLatLng: (latlng: [number, number]) => void
}

function loadScript(src: string, id: string) {
  if (document.getElementById(id)) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.id = id
    script.src = src
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Gagal memuat peta'))
    document.head.appendChild(script)
  })
}

function loadCss(href: string, id: string) {
  if (document.getElementById(id)) return
  const link = document.createElement('link')
  link.id = id
  link.rel = 'stylesheet'
  link.href = href
  document.head.appendChild(link)
}

async function reverseLabel(lat: number, lng: number) {
  try {
    const response = await fetch(`/api/geo/reverse?lat=${lat}&lon=${lng}`)
    const data = (await response.json()) as { display_name?: string }
    return data.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`
  } catch {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
  }
}

export function MapPicker({ value, onChange }: { value: MapPoint | null; onChange: (point: MapPoint) => void }) {
  const mapEl = useRef<HTMLDivElement>(null)
  const leafletRef = useRef<{ map: LeafletMap; marker: LeafletMarker } | null>(null)
  const googleRef = useRef<{ map: GoogleMap; marker: GoogleMarker } | null>(null)
  const [query, setQuery] = useState('')
  const [message, setMessage] = useState('')
  const point = value || JAKARTA
  const usingGoogle = Boolean(googleKey)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    const g = googleRef.current
    if (g) {
      g.map.setCenter({ lat: point.lat, lng: point.lng })
      g.marker.setPosition({ lat: point.lat, lng: point.lng })
    }
    const leaf = leafletRef.current
    if (leaf) {
      leaf.map.setView([point.lat, point.lng], 15)
      leaf.marker.setLatLng([point.lat, point.lng])
    }
  }, [point.lat, point.lng])

  useEffect(() => {
    const el = mapEl.current
    if (!el) return
    let disposed = false
    let leafletMap: LeafletMap | null = null
    let googleMap: GoogleMap | null = null
    let googleMarker: GoogleMarker | null = null

    const emit = async (lat: number, lng: number) => {
      const label = await reverseLabel(lat, lng)
      if (!disposed) onChangeRef.current({ lat, lng, label })
    }

    const setup = async () => {
      if (usingGoogle && googleKey) {
        await loadScript(`https://maps.googleapis.com/maps/api/js?key=${googleKey}&libraries=places`, 'google-maps-js')
        if (disposed || !window.google || !mapEl.current) return
        googleMap = new window.google.maps.Map(mapEl.current, {
          center: { lat: point.lat, lng: point.lng },
          zoom: 15,
          mapTypeControl: false,
          streetViewControl: false,
        })
        googleMarker = new window.google.maps.Marker({
          position: { lat: point.lat, lng: point.lng },
          map: googleMap,
          draggable: true,
        })
        googleMap.addListener('click', (event) => {
          const lat = event.latLng.lat()
          const lng = event.latLng.lng()
          googleMarker?.setPosition({ lat, lng })
          void emit(lat, lng)
        })
        googleMarker.addListener('dragend', () => {
          const pos = googleMarker?.getPosition()
          if (pos) void emit(pos.lat(), pos.lng())
        })
        googleRef.current = { map: googleMap, marker: googleMarker }
        return
      }

      loadCss('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', 'leaflet-css')
      await loadScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', 'leaflet-js')
      if (disposed || !window.L || !mapEl.current) return
      leafletMap = window.L.map(mapEl.current, { scrollWheelZoom: true }).setView([point.lat, point.lng], 14)
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
      }).addTo(leafletMap)
      const marker = window.L.marker([point.lat, point.lng]).addTo(leafletMap)
      leafletMap.on('click', (event) => {
        marker.setLatLng([event.latlng.lat, event.latlng.lng])
        void emit(event.latlng.lat, event.latlng.lng)
      })
      leafletRef.current = { map: leafletMap, marker }
    }

    void setup()
    return () => {
      disposed = true
      leafletMap?.remove()
      if (googleMap) window.google?.maps.event.clearInstanceListeners(googleMap)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usingGoogle])

  const searchAddress = async () => {
    if (!query.trim()) return
    setMessage('Mencari lokasi...')
    try {
      const response = await fetch(`/api/geo/search?q=${encodeURIComponent(query)}`)
      const results = (await response.json()) as { lat: string; lon: string; display_name: string }[]
      if (!results[0]) {
        setMessage('Alamat tidak ditemukan')
        return
      }
      const next = { lat: Number(results[0].lat), lng: Number(results[0].lon), label: results[0].display_name }
      onChange(next)
      setMessage('Lokasi ditemukan. Geser pin jika perlu.')
    } catch {
      setMessage('Gagal mencari alamat')
    }
  }

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setMessage('Browser tidak mendukung lokasi')
      return
    }
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude
        const lng = position.coords.longitude
        onChange({ lat, lng, label: await reverseLabel(lat, lng) })
        setMessage('Lokasi perangkat digunakan')
      },
      () => setMessage('Izin lokasi ditolak'),
    )
  }

  return (
    <div className="map-picker">
      <div className="map-search">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari alamat, gedung, atau kelurahan" />
        <button type="button" onClick={() => void searchAddress()}>Cari</button>
        <button type="button" onClick={useMyLocation}>Lokasi saya</button>
      </div>
      <div ref={mapEl} className="map-canvas" />
      <iframe
        title="Pratinjau Google Maps"
        className="map-embed"
        loading="lazy"
        src={`https://maps.google.com/maps?q=${point.lat},${point.lng}&z=16&hl=id&output=embed`}
      />
      <p className="map-meta">
        Pin: {point.lat.toFixed(6)}, {point.lng.toFixed(6)}
        <a href={`https://www.google.com/maps?q=${point.lat},${point.lng}`} target="_blank" rel="noreferrer">
          Buka di Google Maps
        </a>
      </p>
      {value?.label && <small className="map-label">{value.label}</small>}
      {message && <small className="map-label">{message}</small>}
    </div>
  )
}
