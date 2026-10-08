import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { ROOT } from '@metahuman/core/paths';

/** The Remote agent owns its configured tunnel for the bridge lifetime. */
export async function runRemoteForwarder(
  adapterUrl: string,
  controller: AbortController,
  runBridge: () => Promise<void>,
): Promise<void> {
  const services = JSON.parse(fs.readFileSync(path.join(ROOT, 'etc/services.json'), 'utf8'));
  const service = services.services?.['environment-bridge-remote'] ?? {};
  const endpoint = new URL(adapterUrl);
  if (endpoint.protocol !== 'ws:' || !['127.0.0.1', 'localhost'].includes(endpoint.hostname) || !endpoint.port) {
    throw new Error('Remote Adapter URL must use ws://127.0.0.1:PORT/environment for remote forwarding');
  }
  const transport = service.transport ?? 'cloudflare';
  let command: string;
  let args: string[];
  let credentials: ReturnType<typeof parseEnv> = {};
  if (transport === 'ssh') {
    const target = String(service.sshTarget ?? '').trim();
    if (!target) throw new Error('Configure the Remote agent SSH destination (user@host or SSH host alias)');
    command = 'ssh';
    args = ['-N', '-T', '-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes',
      '-L', `127.0.0.1:${endpoint.port}:127.0.0.1:${service.sshGatewayPort ?? 8790}`, '--', target];
  } else if (transport === 'cloudflare') {
    const hostname = String(service.cloudflareHostname ?? '').trim();
    if (!hostname) throw new Error('Configure the Remote agent Cloudflare hostname');
    const accessEnvFile = String(service.accessEnvFile ?? '').trim();
    credentials = accessEnvFile ? parseEnv(fs.readFileSync(accessEnvFile, 'utf8')) : {};
    command = path.join(ROOT, 'bin/connect-environment');
    args = [hostname, endpoint.port];
  } else {
    throw new Error(`Unknown remote bridge transport: ${transport}`);
  }
  const child = spawn(command, args, {
    env: { ...process.env, ...credentials },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  let forwarderError: Error | undefined;
  const exited = new Promise<void>(resolve => {
    child.once('error', error => { forwarderError = error; controller.abort(); resolve(); });
    child.once('exit', (code, signal) => {
      if (!controller.signal.aborted) {
        forwarderError = new Error(`${transport} forwarder exited (${signal ?? code})`);
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
