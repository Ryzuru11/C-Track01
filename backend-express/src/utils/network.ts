import { networkInterfaces } from 'os';

/**
 * Get all network IP addresses for the server
 * @returns Array of IP addresses
 */
export function getNetworkAddresses(): string[] {
  const interfaces = networkInterfaces();
  const addresses: string[] = [];

  for (const name of Object.keys(interfaces)) {
    const nets = interfaces[name];
    if (!nets) continue;

    for (const net of nets) {
      // Skip internal (loopback) and non-IPv4 addresses
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(net.address);
      }
    }
  }

  return addresses;
}

/**
 * Display server URLs for local and network access
 * @param port Server port number
 */
export function displayServerUrls(port: number | string): void {
  const addresses = getNetworkAddresses();
  const primaryAddress = addresses.length > 0 ? addresses[0] : null;
  
  console.log('\n==================================================');
  console.log('✓ Server berhasil berjalan');
  console.log('==================================================');
  console.log(`📍 Localhost: http://localhost:${port}`);
  if (primaryAddress) {
    console.log(`🌐 Network:   http://${primaryAddress}:${port}`);
  }
  console.log('==================================================\n');
}

/**
 * Get the primary network address (first non-loopback IPv4)
 * @returns Primary IP address or null
 */
export function getPrimaryNetworkAddress(): string | null {
  const addresses = getNetworkAddresses();
  return addresses.length > 0 ? addresses[0] : null;
}
