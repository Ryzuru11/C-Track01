/**
 * TrackingMap — WebView + Leaflet.js.
 * Tidak menggunakan react-native-maps / Google Maps SDK. Tidak butuh API key.
 * Tiles: OpenStreetMap (gratis). Routing: OSRM (gratis).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, StyleSheet, ViewStyle, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import WebView from 'react-native-webview';
import * as Location from 'expo-location';
import { MAP_CONFIG } from '@/config/api.config';

interface Coordinate {
    latitude: number;
    longitude: number;
}

interface TrackingMapProps {
    destinationLatitude: number;
    destinationLongitude: number;
    destinationLabel?: string;
    driverLabel?: string;
    userAvatar?: string | null;
    containerStyle?: ViewStyle;
    mapWrapperStyle?: ViewStyle;
}

function haversineDistance(a: Coordinate, b: Coordinate): number {
    const R = 6371000;
    const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
    const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
    const sinDLat = Math.sin(dLat / 2);
    const sinDLon = Math.sin(dLon / 2);
    const aVal =
        sinDLat * sinDLat +
        Math.cos((a.latitude * Math.PI) / 180) *
        Math.cos((b.latitude * Math.PI) / 180) *
        sinDLon * sinDLon;
    const clamped = Math.min(1, Math.max(0, aVal));
    return R * 2 * Math.atan2(Math.sqrt(clamped), Math.sqrt(1 - clamped));
}

// ── Leaflet HTML (berjalan di WebView, tanpa Google Maps API key) ─────────────

function buildLeafletHTML(
    destLat: number,
    destLng: number,
    destLabel: string,
    tileUrl: string,
): string {
    const safe = destLabel.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>* { margin:0; padding:0; box-sizing:border-box; } html,body,#map { width:100%; height:100%; }</style>
</head>
<body>
<div id="map"></div>
<script>
  var map = L.map('map', { zoomControl:true, attributionControl:true });
  L.tileLayer('${tileUrl}', { maxZoom:19, attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);

  var destIcon = L.divIcon({
    html: '<div style="width:26px;height:26px;background:#E53E3E;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4);"></div>',
    iconSize:[26,26], iconAnchor:[13,26], className:''
  });
  var destMarker = L.marker([${destLat},${destLng}], {icon:destIcon}).addTo(map);
  destMarker.bindPopup('<b>${safe}</b>');

  var driverIcon = L.divIcon({
    html: '<div style="width:20px;height:20px;background:#3B82F6;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 8px rgba(59,130,246,.6);"></div>',
    iconSize:[20,20], iconAnchor:[10,10], className:''
  });
  var driverMarker = null;
  var routeLine = null;

  map.setView([${destLat},${destLng}], 14);

  window.updateMapFromRN = function(msg) {
    try {
      if (msg.type === 'driver') {
        if (!driverMarker) { driverMarker = L.marker([msg.lat,msg.lng],{icon:driverIcon}).addTo(map); }
        else { driverMarker.setLatLng([msg.lat,msg.lng]); }
      } else if (msg.type === 'route') {
        if (routeLine) map.removeLayer(routeLine);
        routeLine = L.polyline(msg.coords.map(function(c){return [c.latitude,c.longitude];}),
          {color:'#4285F4',weight:4,opacity:.85}).addTo(map);
      } else if (msg.type === 'centerDriver') {
        if (driverMarker) map.setView(driverMarker.getLatLng(), 16, {animate:true});
      } else if (msg.type === 'fitBoth') {
        if (driverMarker) map.fitBounds(L.latLngBounds([driverMarker.getLatLng(),[${destLat},${destLng}]]),{padding:[40,40]});
      }
    } catch(e) {}
  };

  setTimeout(function(){
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify({type:'ready'}));
  }, 400);
</script>
</body>
</html>`;
}

function perpendicularDistanceDeg(p: Coordinate, a: Coordinate, b: Coordinate): number {
    const dx = b.longitude - a.longitude;
    const dy = b.latitude - a.latitude;
    if (dx === 0 && dy === 0) {
        return Math.sqrt((p.longitude - a.longitude) ** 2 + (p.latitude - a.latitude) ** 2);
    }
    const t = Math.max(0, Math.min(1,
        ((p.longitude - a.longitude) * dx + (p.latitude - a.latitude) * dy) / (dx * dx + dy * dy)
    ));
    return Math.sqrt(
        (p.longitude - (a.longitude + t * dx)) ** 2 +
        (p.latitude - (a.latitude + t * dy)) ** 2
    );
}

function rdpSimplify(points: Coordinate[], epsilon: number): Coordinate[] {
    if (points.length <= 2) return points;
    let maxDist = 0;
    let maxIdx = 0;
    for (let i = 1; i < points.length - 1; i++) {
        const d = perpendicularDistanceDeg(points[i], points[0], points[points.length - 1]);
        if (d > maxDist) { maxDist = d; maxIdx = i; }
    }
    if (maxDist > epsilon) {
        const left = rdpSimplify(points.slice(0, maxIdx + 1), epsilon);
        const right = rdpSimplify(points.slice(maxIdx), epsilon);
        return [...left.slice(0, -1), ...right];
    }
    return [points[0], points[points.length - 1]];
}

const TrackingMap: React.FC<TrackingMapProps> = ({
    destinationLatitude,
    destinationLongitude,
    destinationLabel = 'Lokasi Tugas',
    driverLabel = 'Posisi Anda',
    userAvatar = null,
    containerStyle,
    mapWrapperStyle,
}) => {
    const webViewRef = useRef<WebView<{}>>(null);
    const isMountedRef = useRef(false);
    const locationSubRef = useRef<Location.LocationSubscription | null>(null);
    const routeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const fetchAbortRef = useRef<AbortController | null>(null);
    const lastRouteFetchRef = useRef<Coordinate | null>(null);
    const isFetchingRoute = useRef(false);
    const isMapReadyRef = useRef(false);
    const driverRef = useRef<Coordinate | null>(null);
    const destRef = useRef<Coordinate>({ latitude: destinationLatitude, longitude: destinationLongitude });
    const lastGpsUpdateRef = useRef(0);

    const [distance, setDistance] = useState(0);
    const [duration, setDuration] = useState(0);
    const [isLoadingLocation, setIsLoadingLocation] = useState(true);
    const [locationError, setLocationError] = useState<string | null>(null);

    useEffect(() => {
        destRef.current = { latitude: destinationLatitude, longitude: destinationLongitude };
    }, [destinationLatitude, destinationLongitude]);

    /** Kirim command ke Leaflet map via injectJavaScript */
    const sendToMap = useCallback((msg: object) => {
        webViewRef.current?.injectJavaScript(
            `(function(){ if(typeof window.updateMapFromRN==='function') window.updateMapFromRN(${JSON.stringify(msg)}); })(); true;`
        );
    }, []);

    const fetchRoute = useCallback(async (origin: Coordinate, dest: Coordinate) => {
        if (!isMountedRef.current || isFetchingRoute.current) return;
        fetchAbortRef.current?.abort();
        const controller = new AbortController();
        fetchAbortRef.current = controller;
        isFetchingRoute.current = true;
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        try {
            const url = `${MAP_CONFIG.OSRM_BASE_URL}/${origin.longitude},${origin.latitude};${dest.longitude},${dest.latitude}?overview=simplified&geometries=geojson`;
            const res = await fetch(url, { signal: controller.signal });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (!isMountedRef.current) return;
            if (data.code === 'Ok' && data.routes?.[0]) {
                const route = data.routes[0];
                let coords: Coordinate[] = (route.geometry?.coordinates ?? []).map(
                    ([lng, lat]: [number, number]) => ({ latitude: lat, longitude: lng })
                );
                if (coords.length > 100) {
                    let epsilon = 0.0001;
                    let simplified = rdpSimplify(coords, epsilon);
                    while (simplified.length > 100) { epsilon *= 2; simplified = rdpSimplify(coords, epsilon); }
                    coords = simplified;
                }
                lastRouteFetchRef.current = origin;
                setDistance(route.distance / 1000);
                setDuration(route.duration / 60);
                sendToMap({ type: 'route', coords });
            }
        } catch (err: any) {
            if (err?.name !== 'AbortError') console.warn('TrackingMap route error:', err?.message ?? err);
        } finally {
            clearTimeout(timeoutId);
            isFetchingRoute.current = false;
        }
    }, [sendToMap]);

    useEffect(() => {
        isMountedRef.current = true;
        const init = async () => {
            try {
                const { status } = await Location.requestForegroundPermissionsAsync();
                if (!isMountedRef.current) return;
                if (status !== 'granted') {
                    setLocationError('Izin lokasi diperlukan');
                    setIsLoadingLocation(false);
                    return;
                }
                const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
                if (!isMountedRef.current) return;
                const initCoord: Coordinate = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
                driverRef.current = initCoord;
                setIsLoadingLocation(false);
                // Jika WebView sudah ready, langsung kirim; jika belum, onMessage 'ready' akan handle
                if (isMapReadyRef.current) {
                    sendToMap({ type: 'driver', lat: initCoord.latitude, lng: initCoord.longitude });
                    fetchRoute(initCoord, destRef.current);
                }
                locationSubRef.current = await Location.watchPositionAsync(
                    { accuracy: Location.Accuracy.Balanced, timeInterval: 5000, distanceInterval: 10 },
                    (loc) => {
                        if (!isMountedRef.current) return;
                        const newCoord: Coordinate = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
                        const now = Date.now();
                        if (now - lastGpsUpdateRef.current >= 2000) {
                            lastGpsUpdateRef.current = now;
                            driverRef.current = newCoord;
                            sendToMap({ type: 'driver', lat: newCoord.latitude, lng: newCoord.longitude });
                        }
                        const lastFetch = lastRouteFetchRef.current;
                        if (!lastFetch || haversineDistance(newCoord, lastFetch) >= 50) {
                            if (routeDebounceRef.current) clearTimeout(routeDebounceRef.current);
                            routeDebounceRef.current = setTimeout(() => fetchRoute(newCoord, destRef.current), 1500);
                        }
                    }
                );
            } catch (err: any) {
                console.warn('TrackingMap GPS init error:', err?.message ?? err);
                if (isMountedRef.current) {
                    setLocationError('Gagal mendapatkan lokasi GPS');
                    setIsLoadingLocation(false);
                }
            }
        };
        init();
        return () => {
            isMountedRef.current = false;
            fetchAbortRef.current?.abort();
            if (routeDebounceRef.current) clearTimeout(routeDebounceRef.current);
            locationSubRef.current?.remove();
            locationSubRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        destRef.current = { latitude: destinationLatitude, longitude: destinationLongitude };
        if (driverRef.current && isMountedRef.current) {
            fetchRoute(driverRef.current, destRef.current);
        }
    }, [destinationLatitude, destinationLongitude, fetchRoute]);

    const centerOnDriver = useCallback(() => sendToMap({ type: 'centerDriver' }), [sendToMap]);
    const fitBothMarkers = useCallback(() => sendToMap({ type: 'fitBoth' }), [sendToMap]);

    const htmlContent = React.useMemo(
        () => buildLeafletHTML(
            destinationLatitude,
            destinationLongitude,
            destinationLabel,
            MAP_CONFIG.MAP_TILE_URL,
        ),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [destinationLatitude, destinationLongitude, destinationLabel],
    );

    const webViewSource = React.useMemo(() => ({ html: htmlContent }), [htmlContent]);

    if (isLoadingLocation) {
        return (
            <View style={[styles.loadingContainer, containerStyle]}>
                <ActivityIndicator size="small" color="#4285F4" />
                <Text style={styles.loadingText}>Mendeteksi posisi GPS…</Text>
            </View>
        );
    }

    if (locationError) {
        return (
            <View style={[styles.errorContainer, containerStyle]}>
                <Text style={styles.errorIcon}>⚠️</Text>
                <Text style={styles.errorText}>{locationError}</Text>
            </View>
        );
    }

    return (
        <View style={[styles.container, containerStyle]}>
            <View style={[styles.mapWrapper, mapWrapperStyle]}>
                <WebView<{}>
                    ref={webViewRef}
                    source={webViewSource}
                    style={styles.map}
                    javaScriptEnabled
                    domStorageEnabled
                    originWhitelist={['*']}
                    mixedContentMode="compatibility"
                    onMessage={(event) => {
                        try {
                            const msg = JSON.parse(event.nativeEvent.data);
                            if (msg.type === 'ready') {
                                isMapReadyRef.current = true;
                                const driver = driverRef.current;
                                if (driver) {
                                    sendToMap({ type: 'driver', lat: driver.latitude, lng: driver.longitude });
                                    fetchRoute(driver, destRef.current);
                                }
                            }
                        } catch { /* ignore */ }
                    }}
                />
            </View>

            {(distance > 0 || duration > 0) && (
                <View style={styles.infoBar}>
                    <View style={styles.infoItem}>
                        <Text style={styles.infoLabel}>📏 Jarak</Text>
                        <Text style={styles.infoValue}>{distance.toFixed(1)} km</Text>
                    </View>
                    <View style={styles.infoDivider} />
                    <View style={styles.infoItem}>
                        <Text style={styles.infoLabel}>⏱️ Estimasi Tiba</Text>
                        <Text style={styles.infoValue}>{Math.ceil(duration)} menit</Text>
                    </View>
                </View>
            )}

            <View style={styles.controls}>
                <TouchableOpacity style={styles.controlBtn} onPress={centerOnDriver}>
                    <Text style={styles.controlBtnText}>📍</Text>
                    <Text style={styles.controlBtnLabel}>Posisi Saya</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.controlBtn} onPress={fitBothMarkers}>
                    <Text style={styles.controlBtnText}>🎯</Text>
                    <Text style={styles.controlBtnLabel}>Lihat Keduanya</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
};

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
    container: {
        borderRadius: 12,
        backgroundColor: '#F3F4F6',
    },
    mapWrapper: {
        height: 240,
        borderTopLeftRadius: 12,
        borderTopRightRadius: 12,
        overflow: 'hidden',
    },
    map: {
        flex: 1,
    },
    loadingContainer: {
        height: 240,
        borderRadius: 12,
        backgroundColor: '#F3F4F6',
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 10,
    },
    loadingText: {
        fontSize: 13,
        color: '#6B7280',
    },
    errorContainer: {
        height: 240,
        borderRadius: 12,
        backgroundColor: '#FEF2F2',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 20,
    },
    errorIcon: {
        fontSize: 28,
    },
    errorText: {
        fontSize: 13,
        color: '#EF4444',
        textAlign: 'center',
    },
    infoBar: {
        flexDirection: 'row',
        backgroundColor: '#fff',
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderTopWidth: 1,
        borderTopColor: '#F3F4F6',
    },
    infoItem: {
        flex: 1,
        alignItems: 'center',
    },
    infoLabel: {
        fontSize: 11,
        color: '#9CA3AF',
        marginBottom: 2,
    },
    infoValue: {
        fontSize: 16,
        fontWeight: '700',
        color: '#111827',
    },
    infoDivider: {
        width: 1,
        backgroundColor: '#E5E7EB',
        marginHorizontal: 12,
    },
    controls: {
        flexDirection: 'row',
        gap: 8,
        padding: 10,
        backgroundColor: '#F9FAFB',
        borderTopWidth: 1,
        borderTopColor: '#F3F4F6',
    },
    controlBtn: {
        flex: 1,
        backgroundColor: '#fff',
        borderRadius: 8,
        paddingVertical: 12,
        paddingHorizontal: 8,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: '#E5E7EB',
        elevation: 2,
        gap: 4,
    },
    controlBtnText: {
        fontSize: 18,
    },
    controlBtnLabel: {
        fontSize: 11,
        fontWeight: '500',
        color: '#374151',
        textAlign: 'center',
    },
});

// React.memo with custom comparator: only re-render when meaningful props change.
// Intentionally ignores containerStyle / mapWrapperStyle object identity so the
// WebView is not destroyed when the parent passes a freshly-created style object.
export default React.memo(TrackingMap, (prev, next) =>
  prev.destinationLatitude === next.destinationLatitude &&
  prev.destinationLongitude === next.destinationLongitude &&
  prev.destinationLabel === next.destinationLabel &&
  prev.driverLabel === next.driverLabel &&
  prev.userAvatar === next.userAvatar
);
