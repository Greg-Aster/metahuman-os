/**
 * GET /api/server-info
 *
 * Returns information about the local server for WiFi network access.
 * Shows IP addresses, port, and connection URLs for mobile devices.
 */
import type { APIRoute } from 'astro';
import os from 'os';

interface NetworkInterface {
  name: string;
  address: string;
  family: string;
  internal: boolean;
}

/**
 * Get all network interfaces with IPv4 addresses
 */
function getNetworkInterfaces(): NetworkInterface[] {
  const interfaces = os.networkInterfaces();
  const results: NetworkInterface[] = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;

    for (const addr of addrs) {
      // Only include IPv4, non-internal addresses
      if (addr.family === 'IPv4') {
        results.push({
          name,
          address: addr.address,
          family: addr.family,
          internal: addr.internal,
        });
      }
    }
  }

  return results;
}

/**
 * Get the primary local IP address (best guess for WiFi)
 */
function getPrimaryLocalIP(): string | null {
  const interfaces = getNetworkInterfaces();

  // Prefer non-internal interfaces
  const external = interfaces.filter(i => !i.internal);

  // Common WiFi interface names
  const wifiPriority = ['wlan', 'wifi', 'wlp', 'en0', 'en1', 'eth'];

  // Sort by priority
  external.sort((a, b) => {
    const aIndex = wifiPriority.findIndex(p => a.name.toLowerCase().includes(p));
    const bIndex = wifiPriority.findIndex(p => b.name.toLowerCase().includes(p));
    return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
  });

  return external[0]?.address || null;
}

export const GET: APIRoute = async ({ request }) => {
  try {
    // Get port from environment or default
    const port = process.env.PORT || 4321;

    // Get all network interfaces
    const interfaces = getNetworkInterfaces();

    // Get primary IP
    const primaryIP = getPrimaryLocalIP();

    // Build connection URLs
    const urls: string[] = [];
    if (primaryIP) {
      urls.push(`http://${primaryIP}:${port}`);
    }

    // Also add localhost for local access
    urls.push(`http://localhost:${port}`);

    // Get hostname
    const hostname = os.hostname();

    // Get platform info
    const platform = os.platform();
    const arch = os.arch();

    return new Response(JSON.stringify({
      success: true,
      server: {
        hostname,
        port: Number(port),
        platform,
        arch,
        primaryIP,
        urls,
        interfaces: interfaces.map(i => ({
          name: i.name,
          address: i.address,
          internal: i.internal,
          url: `http://${i.address}:${port}`,
        })),
      },
      // Instructions for mobile users
      instructions: {
        title: 'Connect from Mobile Device',
        steps: [
          'Make sure your mobile device is on the same WiFi network',
          `Open the MetaHuman app and go to Settings > Server`,
          `Enter the server URL: http://${primaryIP || 'YOUR_IP'}:${port}`,
          'Tap "Test Connection" to verify',
          'Save the server configuration',
        ],
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: (error as Error).message,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
