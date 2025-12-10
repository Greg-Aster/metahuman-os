# Mobile Credentials Issue

## Status: RESOLVED ✅

Fixed on 2025-12-09 by implementing Option A using the existing `getUserContext()` pattern from `model-router.ts`.

**Note:** After this fix, a separate Node.js 12 compatibility issue was discovered: `AbortController is not defined` in `@metahuman/server`'s RunPod provider. This is unrelated to credential loading - the credentials ARE being resolved correctly now. See the "Next Steps" section.

## Changes Made

### 1. `packages/core/src/providers/bridge.ts`
Added unified credential resolution using AsyncLocalStorage context in TWO places:

**In `callProvider()` (for cloud providers like `runpod_serverless`):**
```typescript
// Get credentials from user profile (same pattern as model-router.ts)
const ctx = getUserContext();
const username = ctx?.username;
const userCreds = username ? resolveCredentials(username, 'runpod') : null;

// Build config with user credentials taking priority over deployment config
const config: ProviderConfig = {
  ollama: { endpoint: deploymentConfig.local.ollamaEndpoint },
  runpod: userCreds?.provider === 'runpod' && userCreds.apiKey
    ? { apiKey: userCreds.apiKey, endpoints: { default: userCreds.endpoint || '' } }
    : deploymentConfig.server?.runpod,
  huggingface: deploymentConfig.server?.huggingface,
};
```

**In `callRemoteProvider()` (for remote backends configured in llm-backend.json):**
```typescript
const ctx = getUserContext();
const username = ctx?.username;
const resolved = username ? resolveCredentials(username, remoteConfig.provider) : null;

const credentials = {
  provider: remoteConfig.provider,
  apiKey: resolved?.apiKey || process.env[`${remoteConfig.provider.toUpperCase()}_API_KEY`] || '',
  endpoint: resolved?.endpoint || remoteConfig.serverUrl,
  model: remoteConfig.model || options.model,
};
```

### 2. `packages/core/src/llm-config.ts`
Extended `loadUserCredentials()` to also check `runpod.json` (used by mobile sync):
```typescript
// Fallback: check profile's runpod.json (used by mobile sync and credentials-sync)
const runpodPath = resolveUserConfigPath(username, 'runpod.json');
if (fs.existsSync(runpodPath)) {
  const runpodConfig = JSON.parse(fs.readFileSync(runpodPath, 'utf-8'));
  if (runpodConfig.apiKey) {
    return {
      offlineProvider: 'runpod',
      runpod: {
        apiKey: runpodConfig.apiKey,
        endpointId: runpodConfig.templateId || runpodConfig.endpointId,
      },
    };
  }
}
```

## Why This Works

1. **Same pattern as `model-router.ts`**: The username is already available via `getUserContext()` from AsyncLocalStorage
2. **No parameter threading needed**: The context is automatically passed through the call chain
3. **Unified code path**: Both web and mobile use the exact same credential resolution logic
4. **Priority order preserved**: User profile → System config → Environment variables

## Original Problem Summary

Mobile chat failed with "No API key found for runpod" because:
- Credentials synced correctly to `profiles/<username>/etc/runpod.json`
- But `bridge.ts` only checked environment variables in both code paths
- Environment variables don't exist in nodejs-mobile

## Files Involved

| File | Change |
|------|--------|
| `packages/core/src/providers/bridge.ts` | Added `getUserContext()` + `resolveCredentials()` in both `callProvider()` and `callRemoteProvider()` |
| `packages/core/src/llm-config.ts` | Extended `loadUserCredentials()` to check `runpod.json` fallback |

## Credential Resolution Priority

1. User's `llm-credentials.json` (new unified format)
2. User's `runpod.json` (legacy/mobile sync format)
3. System credentials (if policy allows)
4. Environment variables (fallback)

## Next Steps: Node.js 12 Compatibility

After fixing credential loading, the following error appeared:
```
ReferenceError: AbortController is not defined
    at RunPodServerlessProvider.fetchWithTimeout
```

This is because `@metahuman/server`'s RunPod provider uses `AbortController` which wasn't available until Node.js 15. nodejs-mobile runs Node.js 12.19.0.

**Fix options:**
1. Add an AbortController polyfill to the mobile build
2. Modify `@metahuman/server` to not use AbortController on mobile
3. Use `mobile-providers.ts` (which uses `node-fetch` and works on Node.js 12) instead of `@metahuman/server` for mobile
