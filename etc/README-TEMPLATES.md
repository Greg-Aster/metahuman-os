# System Configuration Templates

## IMPORTANT: NO SILENT DEFAULTS POLICY

```
+=========================================================================+
|  WARNING: Files in this directory are TEMPLATES, not active configs!   |
|                                                                         |
|  These files are NEVER used directly at runtime.                        |
|  They are COPIED to user profiles when missing, then the user's copy    |
|  is used.                                                               |
|                                                                         |
|  DO NOT:                                                                |
|  - Read these files directly in application code                        |
|  - Return these as default values                                       |
|  - Assume these are the "live" configurations                           |
|                                                                         |
|  ALWAYS:                                                                |
|  - Use loadUserConfig() which ensures user has their own copy           |
|  - Use ensureUserConfig() to copy templates to user profiles            |
|  - Let the profile initialization system handle copying                 |
+=========================================================================+
```

## How the Template System Works

1. **User requests a config** (e.g., `models.json`)
2. **System checks user's profile** (`profiles/{username}/etc/models.json`)
3. **If missing**, system looks for template:
   - First: `etc/models.json.template`
   - Then: `etc/models.json` (uses as template)
4. **Template is COPIED to user's profile**
5. **User's copy is loaded** (never the template directly)

## File Naming Convention

- `*.json.template` - Explicit template files
- `*.json` - System defaults (used as templates if no `.template` exists)
- `*.json.example` - Example files with sensitive data placeholders

## For Developers

When adding new config handling:

```typescript
// CORRECT: Uses ensureUserConfig() internally
const config = loadUserConfig('myconfig.json', getDefaultMyConfig(), username);

// WRONG: Returns default directly without saving to profile
if (!fs.existsSync(path)) return getDefaultMyConfig(); // NO!
```

When adding new template files:

1. Create `etc/myconfig.json.template` OR `etc/myconfig.json`
2. Add `_TEMPLATE_WARNING` field to JSON content
3. The system will auto-copy to user profiles when needed

## Template Files in This Directory

Key templates that get copied to user profiles:

- `models.json` - LLM model configuration and role mapping
- `agents.json` - Agent scheduling and configuration
- `runtime.json` - Runtime feature flags
- `operator.json` - Operator system configuration
- `curiosity.json` - Curiosity service settings
- `voice.json` - TTS/STT configuration
- `training.json` - LoRA training parameters
- `cognitive-layers.json` - Cognitive pipeline settings

## See Also

- `packages/core/src/config.ts` - Config loading with NO SILENT DEFAULTS policy
- `packages/core/src/identity.ts` - Persona config loading
- `packages/core/src/profile.ts` - Profile initialization (creates user configs)
