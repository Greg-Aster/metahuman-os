import { getUserByUsername, getUsers } from '@metahuman/core/users';
import { listUserSessions } from '@metahuman/core/sessions';

export interface ActiveOperatorCliOptions {
  help: boolean;
  serverUrl: string;
  sessionId?: string;
  username?: string;
}

export class ActiveOperatorClientError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'ActiveOperatorClientError';
  }
}

function argumentValue(argument: string, name: string): string | undefined {
  const prefix = `--${name}=`;
  return argument.startsWith(prefix) ? argument.slice(prefix.length).trim() : undefined;
}

export function parseActiveOperatorCliOptions(args: string[]): ActiveOperatorCliOptions {
  const options: ActiveOperatorCliOptions = {
    help: false,
    serverUrl: process.env.MH_SERVER_URL?.trim()
      || `http://127.0.0.1:${process.env.PORT?.trim() || '4321'}`,
    sessionId: process.env.MH_SESSION?.trim() || process.env.MH_DEV_SESSION?.trim() || undefined,
  };

  for (const argument of args) {
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }
    const username = argumentValue(argument, 'username');
    if (username !== undefined) {
      options.username = username;
      continue;
    }
    const serverUrl = argumentValue(argument, 'url');
    if (serverUrl !== undefined) {
      options.serverUrl = serverUrl;
      continue;
    }
    const sessionId = argumentValue(argument, 'session');
    if (sessionId !== undefined) {
      options.sessionId = sessionId;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  options.serverUrl = options.serverUrl.replace(/\/+$/, '');
  return options;
}

function resolveUsername(requested?: string): string {
  if (requested) {
    const user = getUserByUsername(requested);
    if (!user) throw new Error(`User not found: ${requested}`);
    return user.username;
  }
  const owner = getUsers().find(user => user.role === 'owner');
  if (!owner) throw new Error('No owner user found; pass --username=USERNAME');
  return owner.username;
}

export function resolveActiveOperatorSession(options: ActiveOperatorCliOptions): string {
  if (options.sessionId) return options.sessionId;

  const username = resolveUsername(options.username);
  const user = getUserByUsername(username);
  if (!user) throw new Error(`User not found: ${username}`);

  const maximumSessionAgeMs = 7 * 24 * 60 * 60 * 1_000;
  const now = Date.now();
  const session = listUserSessions(user.id)
    .filter(candidate => now - Date.parse(candidate.createdAt) <= maximumSessionAgeMs)
    .sort((left, right) => Date.parse(right.lastActivity) - Date.parse(left.lastActivity))[0];

  if (!session) {
    throw new Error(
      `No active session found for ${username}. Log in through the site, pass --session=TOKEN, or set MH_SESSION.`,
    );
  }
  return session.id;
}

export async function requestActiveOperator<T>(
  path: string,
  options: ActiveOperatorCliOptions,
  init: RequestInit = {},
): Promise<T> {
  const sessionId = resolveActiveOperatorSession(options);
  let response: Response;
  try {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    headers.set('Cookie', `mh_session=${sessionId}`);
    if (init.body) headers.set('Content-Type', 'application/json');
    response = await fetch(`${options.serverUrl}${path}`, {
      ...init,
      headers,
    });
  } catch (error) {
    throw new ActiveOperatorClientError(
      `Cannot reach the MetaHuman server at ${options.serverUrl}: ${(error as Error).message}`,
    );
  }

  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof body.error === 'string'
      ? body.error
      : `Active Operator request failed (${response.status})`;
    throw new ActiveOperatorClientError(message, response.status);
  }
  return body as T;
}
