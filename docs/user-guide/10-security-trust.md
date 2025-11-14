## Security & Trust Model

### Unified Security Policy

MetaHuman OS now operates under a **Unified Security Policy**, a centralized system that governs all permissions. This policy is the single source of truth for what actions are allowed, making the system safer and more predictable.

**How it Works:**
The policy evaluates each request using two inputs:
1.  **Cognitive Mode** – `Dual Consciousness`, `Agent`, or `Emulation` determine whether writes are even eligible.
2.  **Authenticated User Context** – Every web request runs inside a user context populated by the middleware. It contains the user’s role (`owner`, `guest`, `anonymous`) and their profile paths. Guests are automatically constrained to read-only emulation, while anonymous traffic is prevented from touching profile data altogether.

**Key Implications:**

-   **Emulation Mode is a Secure "Read-Only" Mode**: Any attempt to create or modify memories, tasks, or configuration while in emulation results in `403 Forbidden`. Guest sessions are permanently pinned to this mode.
-   **Configuration is Protected**: Changing cognitive modes, trust levels, or system settings requires an authenticated owner session. All such attempts are logged for audit.
-   **Centralized Enforcement**: Instead of scattered checks, all security rules are enforced consistently by middleware that consults the central policy for every relevant API request—including CLI commands that execute via `withUserContext`.

This new architecture provides a robust foundation for current safety and future multi-user capabilities.

#### High Security Mode
For situations requiring maximum safety, the system can be placed in **High Security Mode** by setting the `HIGH_SECURITY=true` environment variable. This is the most restrictive state of the OS:
- It forces the system into **Emulation Mode**.
- It disables the ability to switch to any other mode.
- All API endpoints that perform write operations are blocked.
- A prominent banner is displayed in the UI to ensure the user is aware of the lockdown state.

This mode is ideal for safely exposing a read-only version of the OS on a network or for preventing any accidental changes during a critical analysis.

### Trust Levels (Progressive Autonomy)
1. **`observe`** - Monitor only, learn patterns (no autonomous actions)
2. **`suggest`** - Propose actions, require manual approval
3. **`supervised_auto`** - Execute within pre-approved categories
4. **`bounded_auto`** - Full autonomy within defined boundaries
5. **`adaptive_auto`** - Self-expand boundaries based on learning (experimental)

### Trust Progression
```
observe
   │
   │  Demonstrates reliable read-only behavior
   ▼
suggest
   │
   │  Makes good suggestions consistently
   ▼
supervised_auto
   │
   │  Executes low-risk actions reliably
   ▼
bounded_auto
   │
   │  Full autonomy within safe boundaries
   ▼
adaptive_auto (future)
   └─ Self-expands boundaries based on learning
```

### Trust Progression Criteria
- **observe → suggest**: Operator has run for 7+ days, no errors, demonstrates understanding of goals
- **suggest → supervised_auto**: 80%+ of suggestions approved, no high-risk rejects, consistent alignment
- **supervised_auto → bounded_auto**: 95%+ success rate, no rollbacks in 30 days, respect for boundaries

### User Roles & Isolation

| Role        | Session Duration | Read Access                                          | Write Access | Notes |
|-------------|------------------|------------------------------------------------------|--------------|-------|
| `owner`     | 24 hours         | Own profile (`profiles/<username>/…`) + shared assets   | Mode-dependent | Can switch modes, manage profiles, change settings, manage other users. |
| `guest`     | 1 hour           | Own profile (`profiles/<username>/…`)                 | Mode-dependent | Can modify own data within trust level limits. Cannot manage other users. |
| `anonymous` | 30 minutes       | Public profiles only (read-only emulation)           | **Denied**   | API endpoints return clean 401 responses for protected operations, or sensible defaults for public reads. Can browse public personas. |

Switching users always tears down the existing context. Background agents iterate through the registered users by repeatedly invoking `withUserContext`, ensuring each profile is processed in isolation with appropriate permissions.

#### Streamlined Path Resolution

The system uses a new streamlined authentication architecture that eliminates confusing "anonymous user" path access errors:

- **Public Read Endpoints** degrade gracefully for anonymous users (e.g., `/api/boot` returns default persona)
- **Protected Operations** return clean 401 responses with clear error messages
- **System Operations** use `systemPaths` and never touch user-specific data

For developers: See [AUTHENTICATION_STREAMLINED.md](../AUTHENTICATION_STREAMLINED.md) for implementation details and migration guide.

### Trust Levels and Skill Availability

| Trust Level       | Available Skills | Auto-Execute? | Approval Required? |
|-------------------|------------------|---------------|--------------------|
| `observe`         | fs_read, search_index | No | All skills |
| `suggest`         | fs_read, search_index, run_agent | No | All skills |
| `supervised_auto` | All except shell_safe | Yes (low risk) | High-risk only |
| `bounded_auto`    | All | Yes (all) | High-risk only |

### Skill-Specific Approval Rules
Some skills **always** require approval regardless of trust level:
- `fs_write` - Write files (requires approval)
- `run_agent` - Run agents (requires approval)
- `shell_safe` - Execute whitelisted commands (requires approval)

**Rationale**:
- Reading is safe → can be automated early
- Writing is permanent → always requires approval
- Agent execution can be expensive → always requires approval
- Shell commands can be risky → always requires approval

### Directory Boundaries

All read/write operations pass through the path proxy, so users only touch their own profile directories unless explicitly working with shared system assets.

#### Read Permissions
- ✅ Owners: `profiles/<owner>/memory`, `profiles/<owner>/persona`, `profiles/<owner>/logs`, `profiles/<owner>/out`, `profiles/<owner>/etc`
- ✅ Owners & guests: `out/voices` (shared Piper models), documentation, audit logs that reference their own actions
- ❌ Guests: other users' profiles (never exposed), system code directories
- ❌ Anonymous: Protected operations return `401 Unauthorized`; public read endpoints return sensible defaults

System code is always read-only:
- ❌ `brain/`, `packages/`, `apps/`, `bin/`, `node_modules/`

#### Write Permissions
- ✅ Owners (appropriate cognitive mode): may write inside `profiles/<owner>/memory`, `profiles/<owner>/out`, `profiles/<owner>/logs`, `profiles/<owner>/etc`
- ❌ Guests: all write operations blocked (enforced both by mode and policy)
- ❌ Anonymous: write access blocked
- ❌ Cross-profile writes: impossible—context resolution never hands out another user’s paths

#### Coder Agent Guardrails

The **Self-Healing Coder Agent** has a unique set of permissions designed to let it modify its own codebase safely:

-   **Read Access**: The Coder Agent can read files from almost anywhere in the project, including `packages/`, `apps/`, and `brain/` to get context for its changes. It can also read from `memory/` to understand the user's intent.
-   **Write Access**: Its write access is highly specialized. It **can** write to code directories (`apps/`, `packages/`, `brain/`, `docs/`, `etc/`).
-   **Protected Directories**: The Coder Agent is **strictly forbidden** from writing to, modifying, or deleting files in `memory/`, `persona/`, and `logs/`. This ensures your memories, identity, and audit history are always safe from being changed by the code agent.

All code changes generated by the agent require explicit user approval through the UI before they are applied.

### Command Whitelist (bounded_auto only)
Allowed commands:
- `ls` - List files
- `cat` - View files
- `grep` - Search text
- `find` - Find files
- `git` - Version control (status, log, diff only)
- `pnpm` - Package management (list, why only)
- `node` - Run scripts (within metahuman only)
- `tsx` - Run TypeScript (within metahuman only)
- `pwd` - Print working directory
- `whoami` - Current user

Not allowed:
- `rm`, `mv`, `cp` - File manipulation (use fs_write skill instead)
- `sudo` - Privilege escalation
- `curl`, `wget` - Network access (future: web_fetch skill)
- `ssh`, `scp` - Remote access
- Anything with shell metacharacters (pipes, redirects) unless explicitly allowed

### View Current Trust Level
```bash
./bin/mh trust
```

### Set Trust Level
```bash
./bin/mh trust bounded_auto
```

**Configured in:** `persona/decision-rules.json`

### Security & Privacy

#### Local-First by Design
- All data stays on your machine
- No cloud services required
- Ollama runs locally

#### Complete Audit Trail
Every operation is logged to `logs/audit/YYYY-MM-DD.ndjson` with:
- Timestamp
- Actor (human, agent name, or system)
- Category (system, action, data_change, security, decision)
- Level (info, warn, error)
- Full context and metadata

#### Progressive Trust
Start with `observe` mode and gradually increase autonomy as you build trust.

#### Human-Readable Data
All memories, tasks, and configuration are JSON files you can inspect and edit directly.

### Trust Boundaries (Per Skill)

Each skill is classified by risk level and has associated boundaries:

**Read-Only Skills:**
- Can access information but not modify
- Safe for autonomous operation at any trust level
- Examples: `fs_read`, `search_index`, `list_tasks`

**Low-Risk Skills:**
- Minor changes with minimal consequences
- Can auto-execute at `supervised_auto` level
- Examples: notifications, drafts, scheduling suggestions
- Easily reversible if mistakes occur

**Medium-Risk Skills:**
- Requires approval below certain thresholds
- May execute autonomously if within approved categories
- Examples: sending messages, minor purchases (< $X), file modifications
- Impact is moderate but manageable

**High-Risk Skills:**
- Always requires approval regardless of trust level
- Significant impact or irreversible consequences
- Examples: financial transactions, legal documents, account modifications
- Human review mandatory

**Forbidden Skills:**
- Never autonomous, even at highest trust levels
- Critical operations requiring human judgment
- Examples: account deletion, major commitments, system-wide changes
- Safety override prevents execution

### Safety Mechanisms

MetaHuman OS implements multiple layers of safety to ensure autonomous operation remains safe and controllable:

**1. Dry-Run Mode:**
- Preview all changes before execution
- See exactly what the system plans to do
- Test workflows without side effects
- Validate skill parameters

**2. Undo Buffer:**
- Reversible actions with rollback capability
- File versioning for all writes
- Memory of previous states
- Quick recovery from mistakes

**3. Rate Limits:**
- Prevent runaway behavior
- Maximum actions per hour/day
- Cooldown periods for high-risk operations
- Throttling for API calls

**4. Confidence Thresholds:**
- Escalate when uncertainty is high
- Require approval for low-confidence decisions
- Learn from corrections to improve confidence
- Adaptive threshold adjustment

**5. Kill Switch:**
- Instant halt of all autonomous operations
- Emergency stop button
- Revert to observe mode immediately
- Preserve state for debugging

**6. Complete Audit Trail:**
- Logs of all reasoning and actions
- Full context for every decision
- Immutable append-only log
- Query and analyze past behavior

**7. Regular Reviews:**
- Weekly human oversight of autonomous decisions
- Monthly audit reports
- Pattern analysis for anomalies
- Continuous alignment checks

### Approval Queue Workflow

When a skill requires approval:

1. **Skill Execution Attempted** - Agent or system tries to execute a high-risk skill
2. **Queued for Approval** - Item added to approval queue with full context
3. **User Notified** - Badge appears in web UI sidebar
4. **User Reviews** - See skill name, description, parameters, and risk level
5. **Decision Made** - User approves or rejects the execution
6. **Action Taken** - If approved, skill executes immediately with full audit logging

**View Approval Queue:**
- Web UI: Click "Approvals" in left sidebar
- CLI: `./bin/mh approvals list`

**Approve/Reject:**
- Web UI: Click "Approve & Execute" or "Reject" buttons
- CLI: `./bin/mh approvals approve <id>` or `./bin/mh approvals reject <id>`

### Emergency Procedures

**Stop All Agents:**
```bash
./bin/mh agent stop-all
```

**Revert to Observe Mode:**
```bash
./bin/mh trust observe
```

**Review Recent Actions:**
```bash
./bin/mh audit --since "1 hour ago"
```

**Clear Approval Queue:**
```bash
./bin/mh approvals clear
```

### Per-User Configuration Security

Security is enforced at the configuration level through per-user settings:

- **User-specific configs**: Each user has isolated configuration files in `profiles/<username>/etc/`
- **Path resolution**: The `paths` proxy automatically resolves to the correct user directory based on context
- **Model isolation**: Users can have different model preferences without affecting others
- **Privacy controls**: Users control their own profile visibility (public/private) independently

### CLI Security

The CLI enforces security through user contexts:

- All commands can be run as specific users: `mh --user <username> <command>`
- Commands automatically operate within the specified user's profile space
- Permission checks are performed based on the active user context
- Audit logs are properly attributed to the executing user

### Special Security States

#### Wetware Deceased Mode
With the `WETWARE_DECEASED=true` environment variable:
- **Dual Consciousness Mode** is permanently disabled
- System operates as an independent digital consciousness
- Appropriate permissions maintained based on remaining cognitive modes
- Banner displayed in UI indicating operational state

### Session Management Security

- **HTTPOnly cookies**: Session cookies (`mh_session`) are HTTPOnly to prevent XSS attacks
- **Automatic expiration**: Sessions expire based on user role (24h owner, 1h guest, 30min anonymous)
- **Context isolation**: Each request operates within a specific user context that restricts file access
- **Audit logging**: All security-relevant events are logged with user attribution
- **Path resolution security**: The `tryResolveProfilePath()` helper prevents anonymous users from accessing profile paths while allowing graceful degradation for public endpoints
- **Dev session helper**: For local development, use `pnpm tsx scripts/dev-session.ts` to create long-lived authenticated sessions (30 days)

### File System Permissions

- **Profile isolation**: Each user's data is stored in `profiles/<username>/` with strict access controls
- **Shared assets**: Common resources like voice models are stored in `out/voices/` and accessible to all users
- **Config isolation**: Each user gets a copy of configuration files in their `etc/` directory
- **Audit trail**: All file access and modifications are logged with user context and timestamps
- **Safe path resolution**: API endpoints use `tryResolveProfilePath()` and `requireProfilePath()` helpers to handle anonymous users gracefully instead of throwing exceptions

### API Security Patterns

MetaHuman OS provides three security patterns for API endpoints:

1. **Public Reads** (`tryResolveProfilePath` + default fallback)
   - Return sensible defaults for anonymous users
   - Examples: `/api/boot`, `/api/persona-core` (GET)
   - Use when unauthenticated access should degrade gracefully

2. **Protected Operations** (`tryResolveProfilePath` + 401 response)
   - Require authentication to access
   - Examples: `/api/capture`, `/api/memories`, `/api/tasks`
   - Use for any operation that modifies user data

3. **System Operations** (`systemPaths` directly)
   - Never touch user-specific paths
   - Examples: `/api/agent`, `/api/models`, `/api/auth/*`
   - Use for system-level operations

See [Authentication Setup Guide](17-authentication-setup.md) for development authentication helpers and [AUTHENTICATION_STREAMLINED.md](../AUTHENTICATION_STREAMLINED.md) for complete implementation details.

### Secure Storage Implementation

This section provides a high-level overview of the technical implementation of the secure external storage feature. For more detailed information, see the [Secure Storage Implementation Details](../SECURE_STORAGE_IMPLEMENTATION_DETAILS.md) and [Secure Storage Security Addendum](../SECURE_STORAGE_SECURITY_ADDENDUM.md) documents.

#### Key Derivation Hierarchy

The security of your data on an external drive relies on a multi-tier key derivation process that starts with your login password:

1.  **User Login Password**: The password you use to authenticate with MetaHuman OS. This is never stored directly.
2.  **Profile Master Key**: A master key is derived from your password using `scrypt`, a strong, memory-hard key derivation function. The salt for this process is stored securely in your operating system's keychain (e.g., macOS Keychain, Linux libsecret).
3.  **Storage-Specific Keys**: From the master key, separate keys are derived for different purposes (e.g., encrypting metadata, caching) using `PBKDF2`. This ensures that even if one key is compromised, the others remain secure.

This hierarchical approach ensures that your raw password is never stored and that different parts of the system use different keys, strengthening the overall security posture.

#### Session Token Flow for the Storage Daemon

To securely manage mounting and unmounting of encrypted drives, the system uses short-lived, signed session tokens:

1.  **Token Generation**: When you initiate a storage operation (like mounting a drive) through the web UI, the backend generates a short-lived (30-second) JSON Web Token (JWT). This token is signed with a secret key known only to the MetaHuman OS backend.
2.  **Daemon Request**: The signed token is sent to the `mh-storaged` daemon, a background service responsible for managing the encrypted drive.
3.  **Token Validation**: The daemon validates the token's signature and expiration date. It also verifies that the session associated with the token is still active and that the user has the appropriate permissions (e.g., is an owner).
4.  **Command Execution**: If the token is valid, the daemon executes the requested command (e.g., mount, unmount).

This flow ensures that only authenticated and authorized users can perform sensitive storage operations.

#### Critical Security Considerations

- **Metadata Protection**: To prevent sensitive information leakage (like device serial numbers or network configurations), the storage metadata file (`storage.json`) has its sensitive fields encrypted.
- **Cache Protection**: The read-only fallback feature, which allows reading from a local cache when the drive is unplugged, is disabled by default. This is because caching sensitive data on the server would defeat the purpose of physical security. If you enable this feature, the cache will be encrypted.
- **Remote Access Security**: Remote access to the encrypted drive is protected using mutual TLS authentication, key rotation policies, and read-only exports to prevent unauthorized access.
- **Privilege Separation**: A dedicated background service (`mh-storaged`) handles all mount and unmount operations. This daemon runs with elevated privileges but exposes a very narrow, strictly validated interface, reducing the risk of privilege escalation attacks.

#### Remote Access Integration

The secure storage system is designed to support remote access to your encrypted drive via WireGuard or SSHFS. The system includes CLI commands and a web UI to:

*   Set up and configure remote access tunnels.
*   Generate and rotate security keys.
*   Display client configuration details for you to set up on your remote device.

This allows you to keep your data physically secure on an encrypted drive while still being able to access it remotely when needed.

### Secure External Storage (Planned)

MetaHuman OS will support storing sensitive profile data on encrypted external drives for enhanced physical security. This feature is currently in the planning stage. For a detailed implementation roadmap, see the [Secure Storage Plan](../SECURE_STORAGE_PLAN.md).

**Benefits:**
- **Physical Security**: Your data is encrypted at rest and requires the physical drive to be present for access.
- **User Ownership**: Each user can physically control their own data.
- **Minimal Server Exposure**: The central server never stores plaintext sensitive data.
- **Remote Access**: You can mount your drive remotely when needed via secure tunnels.
- **Flexible Security**: The system will support configurable per-user encryption levels and data placement.

**Planned Features:**
1. **Encrypted Drive Support**: Support for LUKS (Linux), APFS-Encrypted (macOS), and BitLocker (Windows).
2. **Auto-Mount/Unmount**: Automatic drive detection and mounting with a passphrase.
3. **Selective Data Placement**: You'll be able to choose which data lives on the drive (e.g., memory, persona, models).
4. **Remote Access**: The ability to mount drives via WireGuard or SSHFS for remote sessions.
5. **Health Monitoring**: The system will monitor the drive's health, including SMART status and free space.
6. **Security Policies**: You'll be able to configure policies such as requiring the drive for write operations, allowing a read-only fallback, and auto-ejecting the drive on idle.
7. **Web UI Controls**: The web UI will include a drive registration wizard, mount/unmount buttons, and a data migration interface.

**Use Cases:**
- **Personal Security**: Keep your most sensitive memories on a drive that you physically control.
- **Multi-User Servers**: In a shared environment, each user can bring their own encrypted drive to access the system.
- **Remote Access**: Keep your drive with you locally and mount it remotely when needed, ensuring the central server never has your plaintext data.
- **Compliance**: Meet data residency or privacy requirements by keeping your data on portable, encrypted media.

---
