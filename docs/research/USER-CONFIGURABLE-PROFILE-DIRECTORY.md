# Research: User-Configurable Profile Directory Location

**Date:** 2025-11-28
**Status:** Research Complete
**Author:** Claude Code

---

## Executive Summary

This document presents research findings on implementing user-configurable profile directory locations in MetaHuman OS. The goal is to give users control over where their profile data is stored, enabling them to use external drives, encrypted volumes, or other secure locations.

---

## Current Architecture Analysis

### Profile Path System

MetaHuman OS uses a multi-user profile system with these key components:

**Directory Structure:**
```
metahuman/
├── profiles/                    # User profile root
│   ├── greggles/               # Per-user profile
│   │   ├── persona/            # Identity, personality
│   │   ├── memory/             # Episodic memories, tasks
│   │   ├── etc/                # User-specific config
│   │   ├── logs/               # User audit logs
│   │   └── out/                # Outputs, adapters
│   ├── guest/                  # Special guest profile
│   └── [other users]/
├── persona/users.json          # User accounts (system-level)
├── logs/run/sessions.json      # Active sessions
├── etc/                        # System-wide config
└── brain/                      # Agents, skills, policies
```

**Path Resolution Architecture:**

```
                    ┌─────────────────────────────────────┐
                    │  API Endpoints / Agents / CLI       │
                    │  (50+ endpoints, 19+ agents)        │
                    └────────────────┬────────────────────┘
                                     │
                                     ▼
                    ┌─────────────────────────────────────┐
                    │  paths.ts (Context-Aware Proxy)     │
                    │  - Checks user context              │
                    │  - Routes to correct profile        │
                    └────────────────┬────────────────────┘
                                     │
                                     ▼
                    ┌─────────────────────────────────────┐
                    │  path-builder.ts                    │
                    │  getProfilePaths(username)          │
                    │  ┌─────────────────────────────┐   │
                    │  │ HARDCODED:                   │   │
                    │  │ profiles/{username}/        │   │
                    │  └─────────────────────────────┘   │
                    └─────────────────────────────────────┘
```

**Key Insight:** All path resolution flows through ONE function (`getProfilePaths(username)`). Modifying this single function enables custom paths for the entire system.

### Authentication System

- **Users:** Stored in `persona/users.json` at system level (not per-profile)
- **Sessions:** Stored in `logs/run/sessions.json`
- **Auth Flow:** Cookie-based with `mh_session` token
- **Roles:** `owner`, `standard`, `guest`, `anonymous`

### Key Files Identified

| File | Purpose |
|------|---------|
| `packages/core/src/path-builder.ts` | Core path construction |
| `packages/core/src/paths.ts` | Context-aware proxy |
| `packages/core/src/context.ts` | User context management |
| `packages/core/src/profile.ts` | Profile initialization |
| `packages/core/src/users.ts` | User CRUD operations |
| `packages/core/src/auth.ts` | Authentication helpers |
| `packages/core/src/sessions.ts` | Session management |

---

## Security Considerations

### Threat Model

| Threat | Risk | Mitigation |
|--------|------|------------|
| Path Traversal | High | Block `..` sequences, validate absolute paths |
| Symlink Attack | High | Resolve symlinks, verify target location |
| TOCTOU Race | Medium | Re-validate on access, atomic operations |
| Privilege Escalation | Medium | Owner-only path changes, audit logging |
| Data Loss | Medium | Graceful fallback, migration confirmation |
| External Drive Removal | Low | Detect disconnection, fallback mode |

### Path Validation Requirements

1. **Absolute paths only** - Prevents relative path confusion
2. **No path traversal** - Block `..` and symlinks to system dirs
3. **Forbidden directories:**
   - `/etc`, `/var`, `/usr`, `/bin`, `/sbin`, `/root`
   - MetaHuman internals: `brain/`, `packages/`, `apps/`, `node_modules/`
4. **Writability check** - Verify directory is writable
5. **Permission audit** - Warn if world-readable (0755 or worse)

### External Storage Considerations

When using USB drives or network mounts:

1. **Device identification** - Store device UUID, not mount point
2. **Mount detection** - Check `/proc/mounts` or similar
3. **Graceful degradation** - Three options when unavailable:
   - `error`: Return 503, show "Profile unavailable"
   - `readonly`: Serve cached data, block writes
   - `cache`: Queue writes locally, sync when available
4. **Eject safety** - Ensure clean state before unmount

### Encryption Options

| Option | Pros | Cons |
|--------|------|------|
| OS-level (LUKS, FileVault) | Simpler, hardware-accelerated, key managed by OS | Requires admin setup |
| App-level (AES-256-GCM) | Portable, per-profile control | Complex key management, slower |

**Recommendation:** Support OS-level encryption first (detect encrypted volumes, show status). Application-level encryption adds significant complexity and should be a Phase 2 feature.

---

## Implementation Approaches Analyzed

### Approach 1: Minimal Change

**Philosophy:** Smallest possible diff, single point of change.

**Changes:**
1. Add `profilePath?: string` to user metadata in `users.ts`
2. Modify `getProfilePaths()` in `path-builder.ts` to check for custom path

**Pros:**
- Very low risk
- Backward compatible
- 2-3 files changed
- Existing profiles work unchanged

**Cons:**
- No security validation
- No graceful fallback
- No external drive support
- No migration UI

**Files Modified:** 2
**Complexity:** Low

### Approach 2: Security-First

**Philosophy:** Prioritize data sovereignty with strong security guarantees.

**Components:**
1. Path validation module with attack prevention
2. External drive detection and monitoring
3. Graceful disconnection handling
4. Profile health monitoring
5. Full audit trail
6. API endpoint with security guards

**Pros:**
- Production-ready security
- External drive support
- Graceful degradation
- Complete audit trail

**Cons:**
- More complexity
- 5-7 files changed
- More testing required

**Files Modified:** 5-7
**Complexity:** Medium

### Approach 3: Full Portable Profile

**Philosophy:** Complete profile portability with export/import workflows.

**Components:**
1. Profile manifest (manifest.json in profile root)
2. Profile registry (central tracking of all profiles)
3. Export/import with archiving
4. CLI commands (mh profile export/import/link)
5. Conflict resolution for sync
6. Dependency tracking (voice models, adapters)

**Pros:**
- Full backup/restore workflow
- Multi-machine support
- Self-describing profiles
- Complete portability

**Cons:**
- High complexity
- 10+ files changed
- Longer implementation time
- Overkill for basic use case

**Files Modified:** 10+
**Complexity:** High

---

## Recommended Approach: Phased Implementation

Based on the research, a phased approach balances immediacy with completeness:

### Phase 1: Core Path Override (Week 1)
- Add `profilePath` to user metadata
- Modify `getProfilePaths()` to use custom path
- Basic validation (absolute path, exists, writable)
- 2-3 files changed

### Phase 2: Security Hardening (Week 2)
- Full path validation module
- Graceful fallback when path unavailable
- Audit logging for path changes
- External drive detection
- +3-4 files

### Phase 3: Migration & UI (Week 3)
- API endpoint for path management
- Settings UI component
- Safe profile migration
- Progress reporting
- +2-3 files

### Phase 4 (Optional): Portable Profiles
- Profile manifest system
- Export/import workflows
- CLI commands
- Multi-instance sync
- +10 files

---

## Data Access Patterns

### Read Access Points

| Component | Directories Read | Frequency |
|-----------|------------------|-----------|
| Chat API | persona/, memory/episodic/ | Every message |
| Task APIs | memory/tasks/ | On demand |
| Agents (organizer) | memory/episodic/ | Every 5 min |
| Agents (reflector) | memory/episodic/ | Hourly |
| Vector index | memory/index/ | On query |
| Boot API | persona/, etc/ | On startup |

### Write Access Points

| Component | Directories Written | Frequency |
|-----------|---------------------|-----------|
| Chat API | memory/episodic/, logs/audit/ | Every message |
| Capture API | memory/episodic/ | On capture |
| Task APIs | memory/tasks/ | On task update |
| Agents | memory/episodic/, logs/audit/ | Periodic |
| Training | out/adapters/, out/datasets/ | Manual trigger |

---

## Edge Cases & Error Handling

### Scenario: External Drive Disconnected Mid-Operation

**Current behavior:** Error, potential data corruption
**Required behavior:**
1. Detect write failure
2. Queue operation to memory
3. Show "External storage unavailable" banner
4. Retry when storage reconnects
5. Audit the event

### Scenario: Profile Path Changed While Agents Running

**Risk:** Agents reading old location, writing to new
**Mitigation:**
1. Stop all agents before path change
2. Migrate data
3. Update config
4. Restart agents
5. Verify new location accessible

### Scenario: Invalid Path Set via Direct DB Edit

**Risk:** System crashes on startup
**Mitigation:**
1. Validate path on every access (not just save)
2. Graceful fallback to default location
3. Log warning but continue operation
4. Show admin notification

---

## Performance Considerations

### Path Resolution Overhead

Current: ~0.1ms (synchronous path.join)
With validation: ~1-5ms (filesystem checks)

**Mitigation:** Cache validation results for 60 seconds per user.

### External Storage Latency

USB 3.0: ~5-10ms additional latency
Network mount: ~10-100ms additional latency

**Mitigation:**
- Async operations where possible
- Read-ahead caching for frequently accessed files
- Background sync for writes

---

## Testing Strategy

### Unit Tests

1. Path validation with various attack vectors
2. Fallback behavior when path unavailable
3. Migration data integrity

### Integration Tests

1. Full workflow: set path → migrate → verify
2. Agent behavior with custom paths
3. Multi-user isolation with mixed paths

### Manual Testing

1. USB drive disconnect during operation
2. Permission denied scenarios
3. Large profile migration (>1GB)

---

## Conclusion

The existing MetaHuman OS architecture is well-suited for this feature due to its centralized path resolution through `getProfilePaths()`. The recommended phased approach allows delivering value quickly (Phase 1 in ~1 week) while building toward a complete, production-ready solution.

Key success factors:
1. Maintain the single-point-of-change architecture
2. Prioritize security validation
3. Provide graceful degradation
4. Full audit trail for compliance
5. Clear UI feedback for users
