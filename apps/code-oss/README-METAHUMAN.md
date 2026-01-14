# MetaHuman Studio - Rebranded VS Code

This is a rebranded version of Visual Studio Code (OSS) customized for MetaHuman OS.

## What Was Done

### ✅ Complete Rebranding
- **Name**: Code - OSS → **MetaHuman Studio**
- **Application ID**: `code-oss` → `metahuman-studio`
- **Data Folder**: `.vscode-oss` → `.metahuman-studio`
- **All platform identifiers updated** (Windows, macOS, Linux)

### ✅ Telemetry Completely Removed
- Disabled at product configuration level
- Stubbed out telemetry service methods
- Default settings changed to OFF
- No data collection or transmission

### ✅ Custom Branding Assets
- Created MetaHuman Studio icon (brain-in-computer design)
- Icon generation tools provided
- Placeholder icons in place with correct naming

## Quick Start

### Generate Final Icons

```bash
cd resources
./generate-pngs.sh
# Opens browser tool - click buttons to download PNGs
# Then move them to correct locations (see ICON-STATUS.md)
```

### Build & Run

```bash
# Install dependencies (if not already done)
npm install

# Compile
npm run compile

# Run in development
./scripts/code-oss.sh
```

## Documentation

| File | Purpose |
|------|---------|
| [METAHUMAN-STUDIO-BRANDING.md](METAHUMAN-STUDIO-BRANDING.md) | Complete list of all branding changes |
| [ICON-STATUS.md](ICON-STATUS.md) | Icon replacement status and quick guide |
| [resources/ICON-GENERATION.md](resources/ICON-GENERATION.md) | Detailed icon generation instructions |
| [resources/metahuman-studio-icon.svg](resources/metahuman-studio-icon.svg) | Master SVG icon source |

## Icon Status

| Icon | Status | Action Needed |
|------|--------|---------------|
| SVG Source | ✅ Created | Ready to use |
| Linux Icon | ⚠️  Placeholder | Replace with real icon |
| Server Icons | ⚠️  Placeholder | Replace with real icons |
| Windows ICO | ❌ Missing | Generate from SVG |
| macOS ICNS | ❌ Missing | Generate from SVG (macOS only) |

**See [ICON-STATUS.md](ICON-STATUS.md) for step-by-step replacement instructions.**

## Verification Checklist

After completing icon replacement:

- [ ] Window title shows "MetaHuman Studio"
- [ ] Application icon shows brain-in-computer (not VS Code logo)
- [ ] Settings → Telemetry is OFF by default
- [ ] No telemetry data sent (check network traffic)
- [ ] Data folder is `~/.metahuman-studio/` (not `~/.vscode-oss/`)

## Key Features Removed

- ❌ GitHub Copilot integration
- ❌ Microsoft telemetry
- ❌ VS Code marketplace URLs

## License

This is a fork of Visual Studio Code (OSS) which is licensed under the MIT License.
See [LICENSE.txt](LICENSE.txt) for details.

## Contributing

For issues or contributions related to MetaHuman Studio branding:
- Report at: https://github.com/metahuman-os/metahuman/issues/new
- Main project: https://github.com/metahuman-os/metahuman

## Upstream

Original VS Code repository: https://github.com/microsoft/vscode

---

**MetaHuman Studio** - Code editor integrated into MetaHuman OS
