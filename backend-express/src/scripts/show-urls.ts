#!/usr/bin/env node

/**
 * Display server network URLs without starting the server
 * Similar to Laravel's "php artisan serve:urls" command
 */

import { getNetworkAddresses } from '../utils/network';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 5001;
const addresses = getNetworkAddresses();

console.log('\n╔════════════════════════════════════════════════════════════════════╗');
console.log('║              📡 BACKEND EXPRESS - SERVER URLS                      ║');
console.log('╠════════════════════════════════════════════════════════════════════╣');
console.log('║                                                                    ║');
console.log('║  📍 LOCAL ACCESS:                                                  ║');
console.log(`║     http://localhost:${PORT}                                        ║`);
console.log(`║     http://127.0.0.1:${PORT}                                        ║`);
console.log('║                                                                    ║');

if (addresses.length > 0) {
  console.log('║  🌐 NETWORK ACCESS (for Mobile/Other Devices):                    ║');
  addresses.forEach((addr) => {
    const url = `http://${addr}:${PORT}`;
    console.log(`║     ${url.padEnd(64, ' ')}║`);
  });
  console.log('║                                                                    ║');
  console.log('║  📱 MOBILE APP CONFIGURATION:                                      ║');
  console.log('║                                                                    ║');
  console.log('║     1. Open: mobile/config/api.config.ts                          ║');
  console.log('║                                                                    ║');
  console.log('║     2. Update API_BASE_URL with:                                   ║');
  console.log(`║        export const API_BASE_URL = 'http://${addresses[0]}:${PORT}/api'       ║`);
  console.log('║                                                                    ║');
  console.log('║     3. Save file and reload Expo app                               ║');
  console.log('║                                                                    ║');
  console.log('║  ⚙️  ANDROID EMULATOR:                                             ║');
  console.log(`║     export const API_BASE_URL = 'http://10.0.2.2:${PORT}/api'         ║`);
  console.log('║                                                                    ║');
  console.log('║  🍎 iOS SIMULATOR:                                                 ║');
  console.log(`║     export const API_BASE_URL = 'http://localhost:${PORT}/api'        ║`);
  console.log('║                                                                    ║');
} else {
  console.log('║  ⚠️  WARNING: No network interfaces found!                         ║');
  console.log('║     Server will only be accessible locally.                        ║');
  console.log('║                                                                    ║');
}

console.log('║  ℹ️  IMPORTANT:                                                     ║');
console.log('║     • Device and computer must be on SAME Wi-Fi network            ║');
console.log('║     • Windows Firewall may need to allow Node.js                   ║');
console.log('║     • Start server with: npm run dev                               ║');
console.log('║                                                                    ║');
console.log('╚════════════════════════════════════════════════════════════════════╝\n');
