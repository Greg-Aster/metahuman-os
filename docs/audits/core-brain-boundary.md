# Core/Brain Boundary Audit

## packages/core/src/storage-client.ts
- Owner: Core engine storage API.
- Summary: Storage router implementation now lives in core. The public `storageClient` import keeps the existing resolve/read/write/delete/list/status methods and compatibility aliases.
- Boundary issues: Fixed the inversion where core imported `brain/services/storage-router.ts`.
- Technical debt: Existing synchronous filesystem behavior and audit side effects were preserved to avoid behavior drift.
- Security/privacy notes: No runtime data, profile content, or secrets were inspected or recorded.
- Test gap: Needs command-level validation through existing architecture guardrail and package typecheck.
- Recommended action: Keep storage routing in core. Migrate remaining legacy callers from `brain/services/storage-router.ts` to `@metahuman/core/storage-client` over time.

## brain/services/storage-router.ts
- Owner: Brain compatibility adapter.
- Summary: Converted to a thin public-core re-export for legacy imports.
- Boundary issues: Fixed direct `../../packages/core/src/...` deep imports in this file by importing from `@metahuman/core/storage-client`.
- Technical debt: The file can be deleted after references to the legacy brain service path are removed.
- Security/privacy notes: No runtime data, profile content, or secrets were inspected or recorded.
- Test gap: Needs command-level validation through existing architecture guardrail and package typecheck.
- Recommended action: Track as a deprecation adapter; do not add new implementation here.

## packages/core/src/mobile-handlers/mobile-agents.ts
- Owner: Currently mixed. Scheduler primitives belong in core/mobile handlers, but concrete agent registrations belong above core.
- Summary: Still imports concrete `brain/agents/*/core.js` modules. This is an architecture violation, but changing it in this pass is not behavior-preserving because the React Native node bridge bundles `packages/core/src/mobile-handlers/index.ts` and expects `initializeMobileAgents` from that bundle.
- Boundary issues: Core imports concrete brain agent implementations for profile sync, organizer, reflector, dreamer, ingestor, curiosity, digest, and desire agents.
- Technical debt: Mobile agent registration needs a brain-side registrar or agent-runtime manifest that can be bundled for nodejs-mobile without making core depend on brain.
- Security/privacy notes: No runtime data, profile content, or secrets were inspected or recorded.
- Test gap: Acceptance should include the architecture guardrail and a React Native handlers bundle build.
- Recommended action: Defer code movement until the mobile bridge loads a brain-owned registration module or `@metahuman/agent-runtime` registrations. Acceptance criteria:
  - `packages/core/src/mobile-handlers/mobile-agents.ts` has no `brain/` imports.
  - Mobile scheduler can accept externally supplied `MobileAgentRegistration[]`.
  - React Native `handlers.js` bundle still exposes `initializeMobileAgents` or an equivalent bridge API.
  - The nodejs-mobile agent initialization path still registers the same agent ids and intervals.
  - `./bin/audit check` does not add new architecture violations.
