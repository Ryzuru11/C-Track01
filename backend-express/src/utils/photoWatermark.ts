import { TaskCoordinates } from './reportPhotoValidation';

export interface PhotoWatermarkData extends TaskCoordinates {
  taskLatitude: number;
  taskLongitude: number;
  serverCapturedAt: Date;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatJakartaTime(date: Date): string {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(date);
}

export function buildPhotoWatermarkSvg(width: number, data: PhotoWatermarkData): Buffer {
  const height = Math.min(220, Math.max(140, Math.round(width * 0.28)));
  const padding = Math.max(10, Math.round(width * 0.025));
  const mapWidth = Math.min(180, Math.round(width * 0.29));
  const mapHeight = height - padding * 2;
  const mapX = width - mapWidth - padding;
  const mapY = padding;
  const fontSize = Math.max(10, Math.min(18, Math.round(width * 0.026)));
  const lineHeight = fontSize + 9;
  const latitudeText = data.latitude.toFixed(6);
  const longitudeText = data.longitude.toFixed(6);
  const timestampText = escapeXml(formatJakartaTime(data.serverCapturedAt));

  const latitudeDelta = (data.latitude - data.taskLatitude) * 111_320;
  const longitudeDelta =
    (data.longitude - data.taskLongitude) * 111_320 * Math.cos((data.taskLatitude * Math.PI) / 180);
  const markerX = Math.max(18, Math.min(mapWidth - 18, mapWidth / 2 + longitudeDelta * 0.5));
  const markerY = Math.max(42, Math.min(mapHeight - 18, mapHeight / 2 - latitudeDelta * 0.5));
  const labelY = height - padding - 10;

  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" fill="#101820" fill-opacity="0.84"/>
      <text x="${padding}" y="${padding + fontSize}" fill="#ffffff" font-family="Arial,sans-serif" font-size="${fontSize}" font-weight="700">C-TRACK • BUKTI FOTO</text>
      <text x="${padding}" y="${padding + fontSize + lineHeight}" fill="#ffffff" font-family="Arial,sans-serif" font-size="${fontSize}">Waktu server: ${timestampText}</text>
      <text x="${padding}" y="${padding + fontSize + lineHeight * 2}" fill="#ffffff" font-family="Arial,sans-serif" font-size="${fontSize}">GPS: ${latitudeText}, ${longitudeText}</text>
      <text x="${padding}" y="${padding + fontSize + lineHeight * 3}" fill="#d1d5db" font-family="Arial,sans-serif" font-size="${Math.max(9, fontSize - 2)}">Peta skematis • jarak maks. 100 m dari tugas</text>
      <g transform="translate(${mapX},${mapY})">
        <rect width="${mapWidth}" height="${mapHeight}" rx="8" fill="#e5e7eb"/>
        <path d="M8 ${mapHeight * 0.28} H${mapWidth - 8} M8 ${mapHeight * 0.72} H${mapWidth - 8} M${mapWidth * 0.28} 8 V${mapHeight - 8} M${mapWidth * 0.72} 8 V${mapHeight - 8}" stroke="#cbd5e1" stroke-width="8"/>
        <path d="M8 ${mapHeight * 0.5} H${mapWidth - 8} M${mapWidth * 0.5} 8 V${mapHeight - 8}" stroke="#ffffff" stroke-width="4"/>
        <circle cx="${mapWidth / 2}" cy="${mapHeight / 2}" r="8" fill="#dc2626" stroke="#ffffff" stroke-width="3"/>
        <circle cx="${markerX}" cy="${markerY}" r="7" fill="#2563eb" stroke="#ffffff" stroke-width="3"/>
        <text x="8" y="${labelY - mapY}" fill="#111827" font-family="Arial,sans-serif" font-size="9" font-weight="700">TUGAS • ANDA</text>
      </g>
    </svg>`;

  return Buffer.from(svg);
}
