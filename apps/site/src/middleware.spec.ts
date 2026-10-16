import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the middleware's actual preflight path without starting the server's
// Coordinator or loading a real user's session and storage.
const source = ts.createSourceFile('middleware.ts', readFileSync(new URL('./middleware.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const preflight = source.statements.filter(statement => ts.isFunctionDeclaration(statement)
  || (ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration =>
    ['MUTATING_METHODS', 'onRequest'].includes(declaration.name.getText(source)))));
const code = ts.transpileModule(preflight.map(statement => statement.getText(source)).join('\n'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function handler() {
  const exports: Record<string, any> = {};
  vm.runInNewContext(code, {
    exports, URL, Response, Headers,
    defineMiddleware: (callback: unknown) => callback,
    process: { env: { MH_EXPOSURE_MODE: 'shared', MH_ALLOWED_ORIGINS: 'https://mh.ainek.io' } },
  });
  return exports.onRequest;
}

test('hosted UI can preflight the PATCH method used by task updates', async () => {
  const url = new URL('https://desktop.ainek.io/api/tasks');
  const request = new Request(url, { method: 'OPTIONS', headers: {
    Host: url.host,
    Origin: 'https://mh.ainek.io',
    'Access-Control-Request-Method': 'PATCH',
    'Access-Control-Request-Headers': 'content-type',
  } });
  const response: Response = await handler()({ url, request }, () => assert.fail('preflight must not execute an API handler'));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://mh.ainek.io');
  assert.equal(response.headers.get('Access-Control-Allow-Credentials'), 'true');
  assert.ok(response.headers.get('Access-Control-Allow-Methods')?.split(', ').includes('PATCH'));
  assert.ok(response.headers.get('Access-Control-Allow-Headers')?.toLowerCase().includes('content-type'));
});

test('cross-origin support retains the existing configured-origin boundary', async () => {
  const url = new URL('https://desktop.ainek.io/api/tasks');
  const request = new Request(url, { method: 'OPTIONS', headers: {
    Host: url.host,
    Origin: 'https://unconfigured.example.test',
    'Access-Control-Request-Method': 'PATCH',
  } });
  const response: Response = await handler()({ url, request }, () => assert.fail('preflight must not execute an API handler'));
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
});
