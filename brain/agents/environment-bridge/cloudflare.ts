import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { ROOT } from '@metahuman/core/paths';

/** The Remote agent owns the existing Access TCP launcher for its lifetime. */
export async function runCloudflareForwarder(
  adapterUrl: string,
  controller: AbortController,
  runBridge: () => Promise<void>,
): Promise<void> {
  const services = JSON.parse(fs.readFileSync(path.join(ROOT, 'etc/services.json'), 'utf8'));
  const service = services.services?.['environment-bridge-remote'] ?? {};
  const hostname = String(service.cloudflareHostname ?? '').trim();
  if (!hostname) throw new Error('Configure the Remote agent Cloudflare hostname');
  const endpoint = new URL(adapterUrl);
  if (endpoint.protocol !== 'ws:' || !['127.0.0.1', 'localhost'].includes(endpoint.hostname) || !endpoint.port) {
    throw new Error('Remote Adapter URL must use ws://127.0.0.1:PORT/environment for Access TCP forwarding');
  }
  const accessEnvFile = String(service.accessEnvFile ?? '').trim();
  const credentials = accessEnvFile ? parseEnv(fs.readFileSync(accessEnvFile, 'utf8')) : {};
  const child = spawn(path.join(ROOT, 'bin/connect-environment'), [hostname, endpoint.port], {
    env: { ...process.env, ...credentials },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  let forwarderError: Error | undefined;
  const exited = new Promise<void>(resolve => {
    child.once('error', error => { forwarderError = error; controller.abort(); resolve(); });
    child.once('exit', (code, signal) => {
      if (!controller.signal.aborted) {
        forwarderError = new Error(`Cloudflare forwarder exited (${signal ?? code})`);
        controller.abort();
      }
      resolve();
    });
  });
  const stop = () => child.kill('SIGTERM');
  controller.signal.addEventListener('abort', stop, { once: true });
  try {
    await runBridge();
    if (forwarderError) throw forwarderError;
  } finally {
    controller.signal.removeEventListener('abort', stop);
    stop();
    await exited;
  }
}
