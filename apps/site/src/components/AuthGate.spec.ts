import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { apiFetch, getApiBaseUrl, isHostedUi, isMobileApp, setBackendUrl } from '../lib/client/api-config.js';

// Execute the component's handlers with its real transport owner, without
// starting a MetaHuman runtime or accessing installation accounts and data.
const component = readFileSync(new URL('./AuthGate.svelte', import.meta.url), 'utf8');
const source = ts.createSourceFile('AuthGate.ts', component.match(/<script lang="ts">([\s\S]*?)<\/script>/)![1], ts.ScriptTarget.Latest, true);
const handlers = ['storeSession', 'selectLoginMachine', 'openAccountView', 'handleLogin', 'continueAsGuest'];
const statements = source.statements.filter(statement =>
  (ts.isFunctionDeclaration(statement) && handlers.includes(statement.name!.text))
  || (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)
    && statement.expression.expression.getText(source) === 'onMount'));
const code = ts.transpileModule(statements.map(statement => statement.getText(source)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

test('unified login routes credentials to the chosen machine, while local login stays same-origin', async () => {
  const keys = ['window', 'localStorage', '__METAHUMAN_STATIC_UI__', 'fetch'] as const;
  const originals = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const stored = new Map<string, string>();
  const requests: { url: string; options?: RequestInit }[] = [];
  let acceptLogin = false;
  let mounted!: () => () => void;
  let completeLogin!: () => void;
  let authChecks = 0;
  let reloads = 0;
  const location = { href: 'https://mh.ainek.io/?login', reload: () => { reloads++; } };
  const windowFixture = Object.assign(new EventTarget(), {
    location,
    history: { state: null, replaceState: (_state: unknown, _title: string, url: URL) => { location.href = url.href; } },
  });
  const storage = {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value); },
    removeItem: (key: string) => { stored.delete(key); },
  };
  try {
    Object.assign(globalThis, {
      window: windowFixture, localStorage: storage, __METAHUMAN_STATIC_UI__: true,
      fetch: async (url: string, options?: RequestInit) => {
        requests.push({ url, options });
        const payload = url.endsWith('/persona-core') ? { persona: { identity: { name: 'Fixture' } } }
          : acceptLogin ? { success: true, user: { username: 'fixture' }, sessionId: 'fixture-session' }
          : { error: 'Wrong password' };
        return new Response(JSON.stringify(payload), { status: acceptLogin ? 200 : 401 });
      },
    });
    const state = vm.createContext({
      apiFetch, getApiBaseUrl, isHostedUi, isMobileApp, setBackendUrl,
      window: windowFixture, localStorage: storage, URL,
      console: { log() {}, error() {} },
      canSyncOnLogin: async () => false,
      onMount: (callback: typeof mounted) => { mounted = callback; },
      setTimeout: (callback: () => void) => { completeLogin = callback; }, clearTimeout() {},
      checkAuth: () => { authChecks++; }, handleApiAuthFailure() {}, handleApiAction() {}, apiActionNoticeTimer: null,
      machineInput: { reportValidity: () => true }, machineAddress: 'https://desktop.ainek.io/',
      username: 'fixture', password: 'fixture-password', error: '', loading: false,
      successMessage: '', showSyncHint: false, isAuthenticated: false, isCheckingAuth: true,
      view: 'login', guestSessionError: '', showProfileSelector: false,
    });
    vm.runInContext(code, state);
    setBackendUrl('https://old.ainek.io');
    mounted()();
    assert.equal(authChecks, 0, 'Change machine must show login even when the previous machine has a session');
    assert.equal(location.href, 'https://mh.ainek.io/');
    mounted()();
    assert.equal(authChecks, 1, 'ordinary reload still restores the selected machine session');

    await state.handleLogin({ preventDefault() {} });
    assert.equal(requests[0].url, 'https://desktop.ainek.io/api/auth/login');
    assert.equal(requests[0].options?.credentials, 'include');
    assert.deepEqual(JSON.parse(String(requests[0].options?.body)), { username: 'fixture', password: 'fixture-password' });
    assert.equal(state.error, 'Wrong password');
    assert.equal(state.loading, false);

    acceptLogin = true;
    state.machineAddress = 'https://q6a.ainek.io';
    await state.handleLogin({ preventDefault() {} });
    assert.equal(requests[1].url, 'https://q6a.ainek.io/api/auth/login');
    assert.equal(requests[2].url, 'https://q6a.ainek.io/api/persona-core');
    assert.equal(state.error, '');
    assert.deepEqual([...stored], [['mh_backend_url', 'https://q6a.ainek.io']], 'web stores only the backend address');
    completeLogin();
    assert.equal(reloads, 1);

    state.machineAddress = 'https://desktop.ainek.io';
    state.openAccountView('forgot-password');
    assert.equal(state.view, 'forgot-password');
    assert.equal(getApiBaseUrl(), 'https://desktop.ainek.io');
    await state.continueAsGuest();
    assert.equal(requests.at(-1)?.url, 'https://desktop.ainek.io/api/auth/guest');
    assert.equal(state.showProfileSelector, true);

    const count = requests.length;
    state.machineInput.reportValidity = () => false;
    await state.handleLogin({ preventDefault() {} });
    assert.equal(requests.length, count, 'an incomplete machine field must use normal form validation');

    Object.assign(globalThis, { __METAHUMAN_STATIC_UI__: false });
    state.machineInput = undefined; // The local form has no machine input.
    await state.handleLogin({ preventDefault() {} });
    assert.equal(requests[count].url, '/api/auth/login');
    assert.equal(requests[count].options?.credentials, 'same-origin');
    assert.equal(stored.get('mh_backend_url'), 'https://desktop.ainek.io', 'local login ignores saved hosted selection');
    location.href = 'http://localhost:4321/?login';
    mounted()();
    assert.equal(authChecks, 2, 'local auth checks its own server regardless of the hosted login link');
  } finally {
    for (const key of keys) {
      const descriptor = originals.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
