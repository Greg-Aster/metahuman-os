# MetaHuman OS Security Overview

**Last Updated**: 2025-11-13

This document provides a high-level overview of MetaHuman OS's multi-layered security architecture.

---

## Security Layers

MetaHuman OS implements defense-in-depth with multiple security layers:

```
┌─────────────────────────────────────────────────────────┐
│ Layer 1: Physical Security (Encrypted External Drives) │
├─────────────────────────────────────────────────────────┤
│ Layer 2: Authentication & Sessions                      │
├─────────────────────────────────────────────────────────┤
│ Layer 3: API Authorization (Path Resolution)            │
├─────────────────────────────────────────────────────────┤
│ Layer 4: Cognitive Mode Security Policy                 │
├─────────────────────────────────────────────────────────┤
│ Layer 5: Trust Levels & Progressive Autonomy            │
├─────────────────────────────────────────────────────────┤
│ Layer 6: Audit Trail (Complete Accountability)          │
└─────────────────────────────────────────────────────────┘
```

---

## Layer 1: Physical Security

### Encrypted External Drives (Planned)

⚠️ **CRITICAL READING**: [SECURE_STORAGE_SECURITY_ADDENDUM.md](SECURE_STORAGE_SECURITY_ADDENDUM.md) contains required security mitigations.

**Purpose**: Protect data at rest through hardware-level encryption

**Features**:
- LUKS/APFS/BitLocker encrypted removable drives
- User-owned physical security (data only accessible when drive connected)
- Auto-mount/unmount with passphrase protection
- Remote access via encrypted tunnels (WireGuard/SSHFS)
- Selective data placement (choose what lives on drive)

**Configuration**: `profiles/<username>/etc/storage.json` (with encrypted sensitive fields)

**Documentation**:
- [SECURE_STORAGE_PLAN.md](SECURE_STORAGE_PLAN.md) - Implementation roadmap
- [SECURE_STORAGE_SECURITY_ADDENDUM.md](SECURE_STORAGE_SECURITY_ADDENDUM.md) - **Required security mitigations**
- [SECURE_STORAGE_IMPLEMENTATION_DETAILS.md](SECURE_STORAGE_IMPLEMENTATION_DETAILS.md) - Key derivation, session tokens, testing
- [SECURE_STORAGE_QUICKSTART.md](SECURE_STORAGE_QUICKSTART.md) - Developer quick start

### Threat Model & Limitations

**What Encrypted Storage Protects:**
- ✅ Data at rest (drive unplugged)
- ✅ Physical theft
- ✅ Server compromise when drive is unmounted

**What Encrypted Storage Does NOT Protect:**
- ❌ Data in use (while drive is mounted)
- ❌ Active host compromise with mounted drive
- ❌ Memory dumps
- ❌ Side-channel attacks

**Mitigations:**
1. Auto-eject on idle (default: 30 minutes)
2. Manual eject when done working
3. Physical security (lock workstation)
4. Full-disk encryption on host OS
5. Future: Memory-level encryption for sensitive fields

See [SECURE_STORAGE_SECURITY_ADDENDUM.md#7-data-at-rest-vs-data-in-use](SECURE_STORAGE_SECURITY_ADDENDUM.md#7-data-at-rest-vs-data-in-use) for complete threat analysis.

---

## Layer 2: Authentication & Sessions

### User Roles

| Role | Session Length | Capabilities | Use Case |
|------|----------------|--------------|----------|
| **Owner** | 24 hours | Full access to own profile, manage system | Primary user |
| **Guest** | 1 hour | Read-only emulation of public profiles | Demonstration |
| **Anonymous** | 30 minutes | Browse public profiles only | Public access |

### Session Management

- **HTTPOnly Cookies**: `mh_session` cookie protected from XSS
- **Automatic Expiration**: Role-based timeout enforcement
- **Context Isolation**: Each request runs in user-specific context
- **Audit Logging**: All authentication events recorded

**Implementation**: [apps/site/src/middleware.ts](../apps/site/src/middleware.ts)

**Documentation**: [docs/user-guide/17-authentication-setup.md](user-guide/17-authentication-setup.md)

---

## Layer 3: API Authorization

### Streamlined Path Resolution

**Problem Solved**: Eliminated confusing "anonymous user cannot access user data paths" errors

**Solution**: Three-tier authorization pattern

#### Pattern 1: Public Reads (Graceful Degradation)

```typescript
const result = tryResolveProfilePath('personaCore');
if (!result.ok) {
  return new Response(JSON.stringify({ default: 'data' }), { status: 200 });
}
// ...proceed with authenticated logic
```

**Use When**: Endpoint should work for anonymous users with sensible defaults

**Examples**: `/api/boot`, `/api/persona-core` (GET)

#### Pattern 2: Protected Operations (Authentication Required)

```typescript
const result = tryResolveProfilePath('episodic');
if (!result.ok) {
  return new Response(
    JSON.stringify({ error: 'Authentication required' }),
    { status: 401 }
  );
}
// ...proceed with operation
```

**Use When**: Endpoint requires authenticated user

**Examples**: `/api/capture`, `/api/memories`, `/api/tasks`

#### Pattern 3: System Operations (No User Context)

```typescript
import { systemPaths } from '@metahuman/core';

const agentPath = path.join(systemPaths.brain, 'agents', `${name}.ts`);
```

**Use When**: Operation doesn't touch user-specific data

**Examples**: `/api/agent`, `/api/models`, `/api/auth/*`

**Implementation**: [packages/core/src/paths.ts:237-399](../packages/core/src/paths.ts#L237-L399)

**Documentation**: [AUTHENTICATION_STREAMLINED.md](AUTHENTICATION_STREAMLINED.md)

---

## Layer 4: Cognitive Mode Security Policy

### Unified Security Policy

Every request is evaluated against cognitive mode + user role:

```typescript
const policy = getSecurityPolicy(context);

if (!policy.canWriteMemory) {
  return new Response(
    JSON.stringify({ error: 'Write access denied' }),
    { status: 403 }
  );
}
```

### Cognitive Modes

| Mode | Write Access | Operator | Proactive Agents | Use Case |
|------|--------------|----------|------------------|----------|
| **Dual Consciousness** | Authenticated users | Always enabled | Enabled | Full system capabilities |
| **Agent Mode** | Authenticated users | Heuristic routing | Disabled | Lightweight assistant |
| **Emulation Mode** | Denied | Disabled | Disabled | Demo/read-only |

**Special Modes**:
- **High Security** (`HIGH_SECURITY=true`): Forces emulation mode, disables writes, shows warning banner
- **Wetware Deceased** (`WETWARE_DECEASED=true`): Disables dual consciousness permanently

**Implementation**: [packages/core/src/security-policy.ts](../packages/core/src/security-policy.ts)

**Documentation**: [docs/user-guide/10-security-trust.md](user-guide/10-security-trust.md)

---

## Layer 5: Trust Levels & Progressive Autonomy

### Trust Progression

```
observe → suggest → supervised_auto → bounded_auto → adaptive_auto
```

### Trust Level Capabilities

| Level | Skills Available | Auto-Execute? | Approval Required? |
|-------|------------------|---------------|--------------------|
| `observe` | Read-only (fs_read, search_index) | No | All skills |
| `suggest` | Read + run_agent | No | All skills |
| `supervised_auto` | All except shell_safe | Yes (low risk) | High-risk only |
| `bounded_auto` | All | Yes (all) | High-risk only |

### Approval Queue

High-risk operations require explicit user approval:

- **Web UI**: "Approvals" tab shows pending actions with full context
- **CLI**: `./bin/mh approvals list/approve/reject <id>`

**Always Require Approval**:
- `fs_write` - File modifications
- `run_agent` - Agent execution
- `shell_safe` - Shell commands

**Configuration**: `profiles/<username>/persona/decision-rules.json`

**Documentation**: [docs/user-guide/10-security-trust.md#trust-levels-and-skill-availability](user-guide/10-security-trust.md#trust-levels-and-skill-availability)

---

## Layer 6: Audit Trail

### Complete Operation Logging

Every security-relevant event is logged to `logs/audit/YYYY-MM-DD.ndjson`:

```json
{
  "timestamp": "2025-11-13T12:00:00Z",
  "level": "info",
  "category": "security",
  "event": "storage_mounted",
  "details": {
    "username": "greggles",
    "deviceId": "UUID-123",
    "mountPoint": "/mnt/mh/greggles"
  },
  "actor": "system"
}
```

### Audit Categories

- `system` - Agent starts/stops, configuration changes
- `action` - User actions, skill executions
- `data_change` - Memory/file modifications
- `security` - Authentication, authorization, policy changes
- `decision` - Autonomous agent decisions

### Audit Levels

- `info` - Normal operations
- `warn` - Potential issues
- `error` - Failures and violations

**Implementation**: [packages/core/src/audit.ts](../packages/core/src/audit.ts)

**Query**: `./bin/mh audit --since "1 hour ago" --category security`

---

## Directory Boundaries & Isolation

### Profile Isolation

Each user's data is strictly isolated:

```
profiles/
├── greggles/           # Owner profile
│   ├── memory/         # ✅ greggles can read/write
│   ├── persona/        # ✅ greggles can read/write
│   ├── logs/           # ✅ greggles can read
│   └── etc/            # ✅ greggles can read/write
└── alice/              # Guest profile
    └── ...             # ❌ greggles CANNOT access
```

### System Code (Read-Only)

- `brain/` - Agents, skills, policies
- `packages/` - Core libraries
- `apps/` - Web UI and CLI
- `bin/` - Executables
- `node_modules/` - Dependencies

**Exception**: Coder Agent can modify system code with explicit approval

### Shared Assets

- `out/voices/` - Piper voice models (all users)
- `docs/` - Documentation (all users)
- `etc/` - System configuration (system/admin only)

---

## Security Best Practices

### For Users

1. **Use Strong Passphrases**: 16+ characters, mix of types
2. **Enable 2FA**: Consider hardware security keys (YubiKey) when available
3. **Regular Backups**: Backup `profiles/` and `persona/users.json` together
4. **Monitor Audit Logs**: Review `logs/audit/` periodically for suspicious activity
5. **Minimize Public Profiles**: Only set profiles to "Public" when necessary
6. **Use High Security Mode**: Enable `HIGH_SECURITY=true` when exposing remotely

### For Developers

1. **Use Helper Functions**: Always use `tryResolveProfilePath()` or `requireProfilePath()`, never direct `paths.*` access
2. **Classify Endpoints**: Determine if endpoint is public read, protected, or system
3. **Audit All Operations**: Log security-relevant events to audit trail
4. **Validate Input**: Sanitize all user input, especially file paths
5. **Test Anonymous Access**: Clear cookies and verify graceful degradation
6. **Dev Session Helper**: Use `pnpm tsx scripts/dev-session.ts` for local development

### For Administrators

1. **Regular Updates**: Keep dependencies updated for security patches
2. **Firewall Rules**: Restrict access to necessary ports only
3. **Encrypted Tunnels**: Use WireGuard/SSH for remote access, never expose raw HTTP
4. **SMART Monitoring**: Check drive health for encrypted storage devices
5. **Backup Recovery Keys**: Store drive recovery keys offline
6. **Review Logs**: Set up log monitoring/alerting for security events

---

## Security Checklist

### Authentication

- [ ] Owner account created with strong passphrase
- [ ] Guest accounts limited to necessary profiles
- [ ] Public profile visibility minimized
- [ ] Sessions configured with appropriate timeouts
- [ ] HTTPOnly cookies enabled

### Authorization

- [ ] All API endpoints use path resolution helpers
- [ ] Anonymous users cannot access protected data
- [ ] Cognitive mode policies enforced
- [ ] Trust level appropriate for use case
- [ ] Approval queue monitored

### Data Protection

- [ ] Encrypted external drives configured (when needed)
- [ ] Regular backups scheduled
- [ ] Recovery keys stored offline
- [ ] SMART health monitoring enabled
- [ ] Auto-eject on idle configured

### Audit & Monitoring

- [ ] Audit logs reviewed weekly
- [ ] Security events monitored
- [ ] Anomaly detection configured
- [ ] Backup integrity verified monthly

### Network Security

- [ ] Firewall rules configured
- [ ] TLS/SSL enabled for remote access
- [ ] VPN/tunnel required for external access
- [ ] Rate limiting enabled
- [ ] DDoS protection configured

---

## Incident Response

### Suspected Unauthorized Access

1. **Immediate Actions**:
   ```bash
   # Stop all agents
   ./bin/mh agent stop-all

   # Revert to observe mode
   ./bin/mh trust observe

   # Eject secure storage
   ./bin/mh storage unmount <username>
   ```

2. **Review Audit Logs**:
   ```bash
   ./bin/mh audit --since "24 hours ago" --category security
   ```

3. **Check Sessions**:
   ```bash
   cat logs/run/sessions.json
   # Look for unfamiliar session IDs
   ```

4. **Change Passphrases**: Update user passwords and drive encryption keys

5. **Analyze Impact**: Determine what data was accessed/modified

### Data Recovery

1. **From Backups**:
   ```bash
   rsync -av backups/profiles/greggles/ profiles/greggles/
   ```

2. **From Encrypted Drive**:
   ```bash
   # Use recovery key if passphrase forgotten
   sudo cryptsetup luksOpen /dev/sdb1 mh_greggles --key-file recovery.key
   ```

3. **From Audit Trail**: Reconstruct timeline of changes

---

## Compliance & Privacy

### Data Residency

- All data stored locally by default
- Optional encrypted external storage for portability
- Remote access via user-controlled tunnels
- No cloud dependencies (unless explicitly configured)

### Privacy Controls

- User-owned data (physically with encrypted drives)
- Complete audit trail for data access
- Granular sharing controls (profile visibility)
- Right to deletion (user can destroy drive)

### GDPR Compliance

- Data minimization (only store what's needed)
- User consent (explicit profile visibility settings)
- Right to access (audit logs, memory exports)
- Right to erasure (delete profile, destroy drive)
- Data portability (JSON exports, encrypted snapshots)

---

## Related Documentation

- **[Authentication Setup](user-guide/17-authentication-setup.md)** - User account management, session handling
- **[Security & Trust](user-guide/10-security-trust.md)** - Trust levels, skill approval, directory boundaries
- **[Streamlined Authentication](AUTHENTICATION_STREAMLINED.md)** - API path resolution patterns
- **[Secure Storage Plan](SECURE_STORAGE_PLAN.md)** - Encrypted external drive implementation
- **[Development Guide](../CLAUDE.md#authentication--path-resolution)** - Developer authentication helpers

---

## Summary

MetaHuman OS security is built on six complementary layers:

1. **Physical**: Encrypted external drives protect data at rest
2. **Authentication**: Role-based sessions with automatic expiration
3. **Authorization**: Streamlined path resolution with graceful degradation
4. **Policy**: Cognitive mode-based write protection
5. **Autonomy**: Trust-based progressive permissions with approval queues
6. **Accountability**: Complete audit trail of all operations

This defense-in-depth approach ensures data security while maintaining usability. Each layer can be configured independently to match your security requirements, from open demonstration mode to fully locked-down encrypted storage.
