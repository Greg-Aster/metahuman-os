# Deferred Work List

This file tracks features that were stubbed or simplified for mobile compatibility and need proper implementation later.

## Profile Sync Cleanup

### 0. IndexedDB Removal from Sync Functions
**Status**: Partially complete
**Completed**:
- `syncFromRemoteServer()` now POSTs to local import API instead of IndexedDB
- Added date range filtering for memory sync (default 7 days)

**Remaining Work**:
- Remove IndexedDB from `downloadProfile()` function
- Remove IndexedDB from `syncProfile()` function
- Clean up any remaining IndexedDB references in profile-sync.ts
- Consider removing idb dependency if no longer needed elsewhere

**Files**: `apps/site/src/lib/client/profile-sync.ts`

---

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

### 2.5. Native Voice Plugin (`apps/mobile/android/.../plugins/voice/NativeVoicePlugin.java`)
**Status**: Stub implementation only
**Intended Features**:
- Native Android audio recording (better quality than WebView)
- Hardware button capture for push-to-talk
- Background audio playback
- Wake word detection

**Current Behavior**: Returns "not implemented" for all methods
**Future Work**: Full Android AudioRecord/MediaPlayer implementation

---

### 2.6. Native LLM Plugin (`apps/mobile/android/.../plugins/llm/NativeLLMPlugin.java`)
**Status**: Stub implementation only
**Intended Features**:
- On-device LLM inference using llama.cpp or similar
- Model loading/unloading from device storage
- Quantized model support for mobile GPUs
- Offline inference capability

**Current Behavior**: Returns "not implemented" for all methods
**Future Work**: llama.cpp JNI bindings, model management, GPU acceleration (Vulkan/OpenCL)

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

## Program Update System

### 5.5. Mobile APK Update UI Component
**Status**: Backend complete, UI needed
**Completed**:
- NativeUpdater Android plugin (download + install APK)
- Server endpoints `/api/mobile/version` and `/api/mobile/download`
- Client-side `app-updater.ts` with platform detection

**Missing UI**:
- Settings panel component to check for updates
- Download progress display
- Release notes display
- "What's new" dialog after update

**Files**: Need new Svelte component in `apps/site/src/components/`

---

### 5.6. APK Release Workflow
**Status**: Manual process, needs automation
**Current Process**:
1. Build APK with `./scripts/build-mobile.sh`
2. Manually copy to `apps/mobile/releases/`
3. Manually update `version.json`

**Future Work**:
- Build script to auto-increment versionCode
- Auto-generate release notes from git commits
- CI/CD integration for releases
- Optional: GitHub Releases integration

---

### 5.7. Server Update UI Component
**Status**: Backend complete, UI needed
**Completed**:
- Server endpoints `/api/server-update` (check/pull) and `/api/server-update/restart`
- Client-side `app-updater.ts` with git status checking

**Missing UI**:
- Settings panel to show available updates
- Commit list display
- Update button with confirmation
- Restart prompt after successful update

**Files**: Need new Svelte component in `apps/site/src/components/`

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
| IndexedDB Cleanup | HIGH | Low | Code cleanup |
| Remote Provider APIs | HIGH | Medium | Critical for mobile |
| Program Update UI | HIGH | Low | Essential feature |
| APK Release Workflow | MEDIUM | Low | DevOps improvement |
| Backend Auto-Detection | MEDIUM | Low | Improves UX |
| Native Voice Plugin | MEDIUM | High | Better audio quality |
| Native LLM Plugin | LOW | Very High | Offline inference |
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

*Last Updated: 2025-12-10*
