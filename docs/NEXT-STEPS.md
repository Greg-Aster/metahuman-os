# Next Steps - Mobile Standalone Mode

**Last Updated**: 2025-12-04

This document outlines the remaining work to complete the mobile three-tier architecture.

---

## Priority 1: Cloud Backend (Phase M4)

**Goal**: Deploy a server that mobile can connect to when home computer is off.

### Option A: Cloud VM (Recommended for MVP)

Deploy the existing Astro server to a cloud VM.

**Pros**: Minimal code changes, uses existing infrastructure
**Cons**: Monthly VM cost (~$10-20/mo)

```bash
# Deployment steps
1. Provision VM (DigitalOcean, Hetzner, or Linode)
2. Install Node.js 20+
3. Clone repo, pnpm install
4. Configure etc/deployment.json for RunPod
5. Set up nginx reverse proxy with SSL
6. Run ./start.sh
```

**Files to create**:
```
deploy/
├── cloud/
│   ├── docker-compose.yml    # Container setup
│   ├── Dockerfile            # Node.js image
│   ├── nginx.conf            # Reverse proxy
│   └── setup.sh              # Provisioning script
```

**Configuration needed**:
```json
// etc/deployment.json
{
  "mode": "server",
  "server": {
    "llmProvider": "runpod_serverless",
    "storagePath": "/data/metahuman",
    "runpod": {
      "endpointId": "${RUNPOD_ENDPOINT_ID}",
      "apiKey": "${RUNPOD_API_KEY}"
    }
  }
}
```

### Option B: Serverless (Lower Cost)

Use Cloudflare Workers or Vercel Edge for API gateway.

**Pros**: ~$0-5/mo, auto-scaling
**Cons**: Requires API rewrite, storage complexity

**Not recommended for MVP** - higher development effort.

### Decision Needed

- [ ] Choose VM provider
- [ ] Choose domain/subdomain for cloud server
- [ ] Decide on storage: local disk vs S3/R2
- [ ] Authentication: reuse existing or add OAuth?

---

## Priority 2: llama.cpp Integration (Phase M0 Native)

**Goal**: Enable true offline chat with on-device LLM.

### Step 1: Build llama.cpp for Android

```bash
# Clone llama.cpp
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp

# Build for Android (requires NDK)
mkdir build-android && cd build-android
cmake .. \
  -DCMAKE_TOOLCHAIN_FILE=$ANDROID_NDK/build/cmake/android.toolchain.cmake \
  -DANDROID_ABI=arm64-v8a \
  -DANDROID_PLATFORM=android-24 \
  -DLLAMA_NATIVE=OFF
make -j
```

**Output**: `libllama.so` for arm64-v8a

### Step 2: Create JNI Bridge

**File**: `apps/mobile/android/app/src/main/cpp/llama_jni.cpp`

```cpp
#include <jni.h>
#include "llama.h"

extern "C" {

JNIEXPORT jlong JNICALL
Java_com_metahuman_os_plugins_llm_LlamaEngine_loadModel(
    JNIEnv *env, jobject thiz, jstring model_path) {

    const char *path = env->GetStringUTFChars(model_path, nullptr);

    llama_model_params params = llama_model_default_params();
    llama_model *model = llama_load_model_from_file(path, params);

    env->ReleaseStringUTFChars(model_path, path);
    return reinterpret_cast<jlong>(model);
}

JNIEXPORT jstring JNICALL
Java_com_metahuman_os_plugins_llm_LlamaEngine_generate(
    JNIEnv *env, jobject thiz, jlong model_ptr, jstring prompt, jint max_tokens) {

    // ... inference implementation
}

}
```

### Step 3: Create Kotlin Wrapper

**File**: `apps/mobile/android/app/src/main/java/com/metahuman/os/plugins/llm/LlamaEngine.kt`

```kotlin
class LlamaEngine {
    private var modelPtr: Long = 0

    external fun loadModel(modelPath: String): Long
    external fun generate(modelPtr: Long, prompt: String, maxTokens: Int): String
    external fun unloadModel(modelPtr: Long)

    companion object {
        init {
            System.loadLibrary("llama_jni")
        }
    }
}
```

### Step 4: Update NativeLLMPlugin

Replace simulated responses with actual LlamaEngine calls.

### Step 5: Model Download

Implement actual GGUF model download in NativeLLMPlugin:
- Download from HuggingFace
- Show progress via `downloadProgress` event
- Save to app's internal storage
- Verify file integrity

### Files to Create/Modify

```
apps/mobile/android/app/
├── src/main/
│   ├── cpp/
│   │   ├── CMakeLists.txt        # NEW: Build config
│   │   ├── llama_jni.cpp         # NEW: JNI bridge
│   │   └── llama.cpp/            # Submodule or copy
│   └── java/com/metahuman/os/plugins/llm/
│       ├── LlamaEngine.kt        # NEW: Kotlin wrapper
│       └── NativeLLMPlugin.kt    # MODIFY: Use LlamaEngine
└── build.gradle                   # MODIFY: Add CMake config
```

### Estimated Effort

| Task | Effort |
|------|--------|
| Build llama.cpp | 2-3 hours |
| JNI bridge | 4-6 hours |
| Kotlin integration | 2-3 hours |
| Model download | 3-4 hours |
| Testing | 4-6 hours |
| **Total** | **15-22 hours** |

---

## Priority 3: Multiple Server Profiles (Phase M3)

**Goal**: Save and quick-switch between server configurations.

### Data Model

```typescript
interface ServerProfile {
  id: string;
  name: string;
  url: string;
  icon: 'home' | 'cloud' | 'work' | 'custom';
  authToken?: string;
  isDefault: boolean;
  lastConnected?: string;
}
```

### Files to Create

- `apps/site/src/lib/client/server-profiles.ts` - CRUD operations
- `apps/site/src/components/ServerProfilePicker.svelte` - Quick switch UI

### UI

- Dropdown in header for quick switching
- Full management in ServerSettings
- Auto-reconnect to last working server

### Estimated Effort: 4-6 hours

---

## Priority 4: Offline Queue (Phase M6)

**Goal**: Queue messages when offline, send when back online.

### Current State

Memory sync (M8) already handles memory queuing. This phase adds:
- Message queue for chat when all tiers unavailable
- Optimistic UI (show "sending..." state)
- Retry logic with exponential backoff

### Files to Create

- `apps/site/src/lib/client/offline-queue.ts`

### Estimated Effort: 3-4 hours

---

## Testing Checklist

### Before Cloud Deploy (M4)

- [ ] Server URL switching works
- [ ] Health detection accurate
- [ ] Graceful degradation when server offline

### Before llama.cpp (M0)

- [ ] APK builds with NDK
- [ ] libllama.so loads without crash
- [ ] Basic inference works
- [ ] Memory usage acceptable (<2GB)
- [ ] Battery impact acceptable

### Before Production

- [ ] Sync works both directions
- [ ] Conflicts resolved correctly
- [ ] No data loss scenarios
- [ ] All tiers tested independently

---

## Questions to Resolve

### Infrastructure

1. **Cloud VM provider**: DigitalOcean ($12/mo), Hetzner ($4/mo), or Linode ($12/mo)?
2. **Domain**: Subdomain of dndiy.org or new domain?
3. **SSL**: Let's Encrypt via nginx or Cloudflare proxy?

### Security

4. **Mobile auth**: How does mobile authenticate with cloud server?
   - Option A: Same session cookies (requires CORS)
   - Option B: API tokens stored in Android Keystore
   - Option C: OAuth flow

5. **API key storage**: How to safely store RunPod API key on mobile?
   - Option A: Don't - always proxy through server
   - Option B: Android Keystore with biometric unlock
   - Option C: Encrypted SharedPreferences

### Data

6. **Storage for cloud**: Network volume or object storage (S3/R2)?
7. **Sync frequency**: 30s good enough or need real-time (WebSocket)?

---

## Quick Start Commands

### Build and Test Web

```bash
cd apps/site && pnpm build && pnpm preview
```

### Build Mobile APK

```bash
cd apps/mobile && ./scripts/build-mobile.sh
```

### Install APK on Device

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

### View Mobile Logs

```bash
adb logcat -s Capacitor:* NativeLLM:* NativeVoice:*
```

---

## Timeline Estimate

| Phase | Effort | Dependencies |
|-------|--------|--------------|
| M4: Cloud backend | 8-12 hours | VM provisioning |
| M0: llama.cpp native | 15-22 hours | NDK setup |
| M3: Server profiles | 4-6 hours | None |
| M6: Offline queue | 3-4 hours | None |
| Testing & Polish | 8-12 hours | All above |
| **Total** | **38-56 hours** | |

---

## Recommended Order

1. **M4 (Cloud)** - Enables mobile use without home server
2. **M3 (Profiles)** - Better UX for switching servers
3. **M0 (llama.cpp)** - True offline capability
4. **M6 (Queue)** - Polish for edge cases

Cloud first because it has the highest user impact with lowest technical risk.
