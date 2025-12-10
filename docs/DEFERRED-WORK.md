# Deferred Work List

This file tracks features that were stubbed or simplified for mobile compatibility and need proper implementation later.

## Mobile Compatibility Stubs

### 1. Encryption Handler (`packages/core/src/api/handlers/encryption.ts`)
**Status**: Stubbed with mobile fallback
**Desktop Features**:
- LUKS encryption detection and status
- VeraCrypt volume management
- Native disk encryption capabilities

**Current Behavior**: Returns `{ luks: false, veracrypt: false, native: false }` on mobile
**Future Work**: Consider mobile-specific encryption (Android Keystore, iOS Keychain)

---

### 2. External Storage Client (`packages/core/src/api/handlers/voice-samples.ts`)
**Status**: Lazy-loaded with mobile fallback
**Desktop Features**:
- External USB/mounted drive detection
- Voice training sample storage on external drives
- Storage path resolution for multiple devices

**Current Behavior**: Returns "Voice training not available on mobile" error
**Future Work**: Android Storage Access Framework, iOS Files integration

---

### 3. Profile Path Security (`packages/core/src/api/handlers/profile-path.ts`)
**Status**: Lazy-loaded with mobile fallback
**Desktop Features**:
- `getProfilePathsWithStatus()` - path existence and permissions checking
- Security validation for profile directories
- Multi-user isolation verification

**Current Behavior**: Falls back to basic `getProfilePaths()` without status
**Future Work**: Android scoped storage permissions, iOS sandbox verification

---

## Intelligent Backend System (Partial)

### 4. Remote Provider Implementation (`packages/core/src/providers/bridge.ts`)
**Status**: Structure in place, providers need full implementation
**Configured Providers**:
- [x] Claude (Big Brother) - needs API key configuration
- [ ] RunPod - needs pod management
- [ ] OpenRouter - needs API integration
- [ ] OpenAI - needs API integration
- [ ] Custom Server - needs URL configuration

**Current Behavior**: Framework exists, `callRemoteProvider()` returns "not implemented" for most
**Future Work**: Full API clients for each remote provider

---

### 5. Backend Auto-Detection Refinement
**Status**: Basic implementation complete
**Current Logic**:
1. Check preferred local backend (ollama/vllm)
2. Try alternate local backend
3. Fall back to remote if configured
4. Return offline if nothing available

**Future Work**:
- Network latency testing for remote providers
- GPU capability detection for local backend selection
- Cost optimization (prefer local when possible)
- Model capability matching (some models only on certain providers)

---

## UI/UX Improvements Needed

### 6. Status Widget Remote Provider Display
**Status**: Basic support added
**Current Display**: Shows "remote" with provider name
**Future Work**:
- Provider-specific icons
- Connection quality indicator
- Cost/usage tracking display
- Provider switching UI

---

### 7. Mobile Sync Notifications
**Status**: Added basic notifications
**Current Behavior**: Shows toast on sync complete
**Future Work**:
- Progress bar for large syncs
- Conflict resolution UI
- Background sync status in notification bar
- Sync history/log viewer

---

## Priority Matrix

| Item | Priority | Effort | Impact |
|------|----------|--------|--------|
| Remote Provider APIs | HIGH | Medium | Critical for mobile |
| Backend Auto-Detection | MEDIUM | Low | Improves UX |
| Encryption (mobile) | LOW | High | Security feature |
| External Storage | LOW | Medium | Power user feature |
| Profile Path Security | LOW | Low | Already works |
| Status Widget UI | MEDIUM | Low | Polish |
| Sync Notifications | MEDIUM | Low | UX improvement |

---

## Notes

- Mobile uses nodejs-mobile (Node.js 12.19.0) - limited crypto APIs
- Android/iOS have different storage models than desktop
- Remote providers require API keys stored securely
- Consider caching remote responses for offline mode

---

*Last Updated: 2025-12-09*
