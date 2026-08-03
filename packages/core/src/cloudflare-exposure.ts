const TUNNEL_EXPOSURE_SOURCE = 'cloudflare-tunnel'

export interface TunnelExposureState {
  mode: 'local' | 'shared'
  source: string | null
  hostname: string | null
  origin: string | null
}

function appendCsvValue(current: string | undefined, value: string): string {
  const values = (current || '')
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean)

  if (!values.includes(value)) values.push(value)
  return values.join(',')
}

function parseTunnelEndpoint(hostname: string): { hostname: string; origin: string } {
  const raw = hostname.trim()
  if (!raw) throw new Error('Cloudflare tunnel hostname is required for shared exposure')

  const url = new URL(raw.includes('://') ? raw : `https://${raw}`)
  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || url.pathname !== '/'
    || url.search
    || url.hash
  ) {
    throw new Error(`Invalid Cloudflare tunnel hostname: ${hostname}`)
  }

  return {
    hostname: url.host,
    origin: url.origin,
  }
}

/**
 * Admit requests from the configured Cloudflare hostname without widening the
 * listener itself. Runtime request guards read these values for every request.
 */
export function activateTunnelExposure(hostname: string): TunnelExposureState {
  const endpoint = parseTunnelEndpoint(hostname)

  if (process.env.MH_EXPOSURE_MODE !== 'shared') {
    process.env.MH_EXPOSURE_MODE = 'shared'
    process.env.MH_EXPOSURE_SOURCE = TUNNEL_EXPOSURE_SOURCE
  }

  process.env.HOST ||= '127.0.0.1'
  process.env.MH_ALLOWED_HOSTS = appendCsvValue(process.env.MH_ALLOWED_HOSTS, endpoint.hostname)
  process.env.MH_ALLOWED_ORIGINS = appendCsvValue(process.env.MH_ALLOWED_ORIGINS, endpoint.origin)

  return getTunnelExposureState(endpoint)
}

/**
 * Return to local request handling only when Cloudflare was the component that
 * enabled sharing. An explicitly shared LAN/server launch remains shared.
 */
export function deactivateTunnelExposure(): TunnelExposureState {
  if (process.env.MH_EXPOSURE_SOURCE === TUNNEL_EXPOSURE_SOURCE) {
    process.env.MH_EXPOSURE_MODE = 'local'
    delete process.env.MH_EXPOSURE_SOURCE
  }

  return getTunnelExposureState()
}

export function getTunnelExposureState(
  endpoint?: { hostname: string; origin: string },
): TunnelExposureState {
  return {
    mode: process.env.MH_EXPOSURE_MODE === 'shared' ? 'shared' : 'local',
    source: process.env.MH_EXPOSURE_SOURCE || null,
    hostname: endpoint?.hostname || null,
    origin: endpoint?.origin || null,
  }
}
