import os from 'node:os';
import type { UnifiedResponse } from '../types.js';

interface NetworkInterface {
  name: string;
  address: string;
  family: string;
  internal: boolean;
}

function getNetworkInterfaces(): NetworkInterface[] {
  const interfaces = os.networkInterfaces();
  const results: NetworkInterface[] = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;

    for (const addr of addrs) {
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

function getPrimaryLocalIP(): string | null {
  const interfaces = getNetworkInterfaces();
  const external = interfaces.filter((i) => !i.internal);
  const wifiPriority = ['wlan', 'wifi', 'wlp', 'en0', 'en1', 'eth'];

  external.sort((a, b) => {
    const aIndex = wifiPriority.findIndex((p) => a.name.toLowerCase().includes(p));
    const bIndex = wifiPriority.findIndex((p) => b.name.toLowerCase().includes(p));
    return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
  });

  return external[0]?.address || null;
}

export async function handleGetServerInfo(): Promise<UnifiedResponse> {
  try {
    const port = process.env.PORT || 4321;
    const interfaces = getNetworkInterfaces();
    const primaryIP = getPrimaryLocalIP();
    const urls: string[] = [];

    if (primaryIP) {
      urls.push(`http://${primaryIP}:${port}`);
    }
    urls.push(`http://localhost:${port}`);

    return {
      status: 200,
      data: {
        success: true,
        server: {
          hostname: os.hostname(),
          port: Number(port),
          platform: os.platform(),
          arch: os.arch(),
          primaryIP,
          urls,
          interfaces: interfaces.map((i) => ({
            name: i.name,
            address: i.address,
            internal: i.internal,
            url: `http://${i.address}:${port}`,
          })),
        },
        instructions: {
          title: 'Connect from Mobile Device',
          steps: [
            'Make sure your mobile device is on the same WiFi network',
            'Open the MetaHuman app and go to Settings > Server',
            `Enter the server URL: http://${primaryIP || 'YOUR_IP'}:${port}`,
            'Tap "Test Connection" to verify',
            'Save the server configuration',
          ],
        },
      },
    };
  } catch (error) {
    return {
      status: 500,
      data: {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    };
  }
}
