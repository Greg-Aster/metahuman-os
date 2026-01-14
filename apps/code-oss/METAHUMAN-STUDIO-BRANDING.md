# MetaHuman Studio Branding

This document describes the changes made to brand code-oss as "MetaHuman Studio" and remove Microsoft telemetry.

## Branding Changes Made

### 1. Product Configuration (`product.json`)

Updated all branding identifiers:

- **Name**: Changed from "Code - OSS" to "MetaHuman Studio"
- **Application Name**: `code-oss` → `metahuman-studio`
- **Data Folder**: `.vscode-oss` → `.metahuman-studio`
- **URL Protocol**: `code-oss://` → `metahuman-studio://`
- **Icon Name**: `code-oss` → `metahuman-studio`

**Platform-Specific Changes:**

- **Windows**:
  - Directory: `Microsoft Code OSS` → `MetaHuman Studio`
  - App ID: New UUIDs generated for MetaHuman Studio
  - Shell Name: `C&ode - OSS` → `MetaHuman &Studio`

- **macOS**:
  - Bundle Identifier: `com.visualstudio.code.oss` → `com.metahuman.studio`
  - Profile UUIDs: New UUIDs generated

- **Linux**:
  - Icon Name: `code-oss` → `metahuman-studio`

**URLs Updated:**
- License: Points to `https://github.com/metahuman-os/metahuman/blob/main/LICENSE`
- Issue Reporting: Points to `https://github.com/metahuman-os/metahuman/issues/new`

### 2. Telemetry Removal

**Configuration Changes:**
- Removed GitHub Copilot integration (not needed for MetaHuman Studio)
- Added `enabledTelemetryLevels` with all options set to `false`
- Cleared telemetry endpoint configuration (`build/azure-pipelines/common/telemetry-config.json`)

**Code Changes:**
- Stubbed out `TelemetryService._log()` and `TelemetryService._doLog()` methods
  - Both now immediately return without collecting or sending data
  - Marked with comments: `// METAHUMAN STUDIO: Telemetry disabled - no data collection`
- Changed default telemetry settings to OFF:
  - `telemetry.telemetryLevel`: default changed from `ON` → `OFF`
  - `telemetry.enableTelemetry`: default changed from `true` → `false`

## Icon Files

### ✅ Icon Creation Completed

A custom MetaHuman Studio icon has been created:
- **Source**: `resources/metahuman-studio-icon.svg`
- **Design**: Brain-in-computer with MetaHuman OS color scheme
- **Status**: See [ICON-STATUS.md](ICON-STATUS.md) for detailed icon replacement instructions

### Icon Generation Tools Available

1. **Browser-based**: `resources/svg-to-png.html` - Click to download PNGs
2. **Script**: `resources/generate-pngs.sh` - Opens browser generator
3. **Node.js**: `resources/generate-icons.js` - Requires sharp library
4. **Documentation**: `resources/ICON-GENERATION.md` - Complete guide

### Icons That Need Replacement

Placeholder icons (old VS Code icons) are currently in place with MetaHuman Studio naming:

#### Linux Icons
- `apps/code-oss/resources/linux/code.png` - Main application icon

#### Windows Icons
- `apps/code-oss/resources/win32/code_150x150.png` - Application icon
- `apps/code-oss/resources/win32/*.ico` - File type association icons (optional)

#### macOS Icons
- `apps/code-oss/resources/darwin/*.icns` - Application icon bundle

#### Server/Web Icons
- `apps/code-oss/resources/server/code-512.png` - Large icon
- `apps/code-oss/resources/server/code-192.png` - Medium icon
- `apps/code-oss/resources/server/favicon.ico` - Browser favicon

### Recommended Icon Specifications

**Application Icon:**
- Format: PNG with transparency
- Sizes needed: 16x16, 32x32, 48x48, 64x64, 128x128, 256x256, 512x512
- Style: Should represent MetaHuman branding/logo

**Favicon:**
- Format: ICO or PNG
- Size: 16x16, 32x32
- Should be recognizable at small sizes

### Icon Naming Convention

After creating new icons, ensure they match the new naming in `product.json`:
- Linux: `metahuman-studio.png`
- Icon name referenced: `linuxIconName: "metahuman-studio"`

## Build & Testing

After icon replacement, rebuild the application:

```bash
cd apps/code-oss
npm run compile
npm run watch  # for development
```

To test the branding changes:

1. Launch the application
2. Check the window title shows "MetaHuman Studio"
3. Open Settings → Telemetry and verify it defaults to OFF
4. Check that no telemetry data is being sent (can monitor network traffic)

## Additional Files That May Reference VSCode/Microsoft

If further de-branding is needed, check these files:

- `apps/code-oss/README.md` - May contain VSCode references
- `apps/code-oss/LICENSE.txt` - Ensure proper attribution
- `apps/code-oss/package.json` - Check name, description, author fields
- Extension manifests in `apps/code-oss/extensions/*/package.json`

## Summary

**Completed:**
- ✅ Product configuration rebranded to MetaHuman Studio
- ✅ All telemetry collection disabled and stubbed out
- ✅ GitHub Copilot integration removed
- ✅ Platform-specific identifiers updated
- ✅ URLs updated to point to MetaHuman repositories
- ✅ SVG icon created with brain-in-computer design
- ✅ Icon generation tools and documentation provided
- ✅ Placeholder icons created (temporary VS Code icons with new naming)

**Remaining:**
- ⏳ Replace placeholder icons with MetaHuman Studio icons (see ICON-STATUS.md)
- ⏳ Test build with new branding
- ⏳ Verify no telemetry is sent

## Notes

The telemetry system has been completely disabled at multiple levels:
1. Product configuration sets `enabledTelemetryLevels` to all false
2. Default settings are OFF
3. The actual logging methods are stubbed to return immediately
4. No telemetry endpoints are configured

This ensures no data collection occurs even if telemetry code is accidentally invoked.
