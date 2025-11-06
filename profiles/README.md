# User Profiles Directory

This directory contains all user-specific data for the multi-user MetaHuman OS system.

## Structure

```
profiles/
├── {username}/              # Per-user profile directory
│   ├── persona/            # User's identity, personality, and values
│   ├── memory/             # User's episodic, semantic, and procedural memories
│   ├── logs/               # User's audit trail and activity logs
│   ├── etc/                # User's configuration files
│   └── out/                # User's generated content and LoRA adapters
└── README.md               # This file
```

## Privacy

**All user profiles are private and excluded from version control** via `.gitignore`.

Only the following are tracked:
- This README file
- Empty `.gitkeep` placeholder files

## Creating a New User

New users are automatically created when they register via the web UI or can be manually created via the CLI:

```bash
# Via web UI (recommended)
http://localhost:4321/

# Via CLI (for admins)
./bin/mh user create <username>
```

## Profile Initialization

When a new profile is created, the system automatically:
1. Creates the directory structure
2. Copies default persona templates
3. Initializes empty memory directories
4. Sets up default configuration files
5. Creates initial audit log

## Migration

To migrate existing root-level data to a profile:

```bash
# Dry run first
pnpm tsx scripts/migrate-to-profiles.ts --username <your-username> --dry-run

# Actual migration
pnpm tsx scripts/migrate-to-profiles.ts --username <your-username>
```

## Data Location

- **Single-user (legacy)**: `memory/`, `persona/`, `logs/`, `etc/`, `out/`
- **Multi-user**: `profiles/{username}/memory/`, `profiles/{username}/persona/`, etc.

The system automatically detects which mode to use based on whether a user context is active.
