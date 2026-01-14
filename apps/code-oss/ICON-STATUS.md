# MetaHuman Studio Icon Status

## ✅ Completed

1. **SVG Icon Created** - [resources/metahuman-studio-icon.svg](resources/metahuman-studio-icon.svg)
   - Brain-in-computer design
   - MetaHuman OS color scheme (dark theme)
   - 512x512 scalable vector graphic

2. **Placeholder Icons** - Temporary VS Code icons copied with MetaHuman Studio naming
   - `linux/metahuman-studio.png` ✓ (placeholder)
   - `server/code-512.png` ✓ (existing)
   - `server/code-192.png` ✓ (existing)
   - `server/favicon.ico` ✓ (existing)

3. **Icon Generation Tools**
   - [resources/svg-to-png.html](resources/svg-to-png.html) - Browser-based PNG generator
   - [resources/generate-pngs.sh](resources/generate-pngs.sh) - Launch script
   - [resources/generate-icons.js](resources/generate-icons.js) - Node.js script (requires sharp)
   - [resources/ICON-GENERATION.md](resources/ICON-GENERATION.md) - Complete documentation

## 🔄 Next Steps: Replace Placeholder Icons

### Quick Method (Browser-Based)

```bash
cd apps/code-oss/resources
./generate-pngs.sh
```

This will open [svg-to-png.html](resources/svg-to-png.html) in your browser where you can:
1. Click size buttons to download PNG files
2. Rename and move them to the correct locations:

```bash
# After downloading from browser:
mv ~/Downloads/metahuman-studio-512x512.png linux/metahuman-studio.png
mv ~/Downloads/metahuman-studio-512x512.png server/code-512.png
mv ~/Downloads/metahuman-studio-192x192.png server/code-192.png
mv ~/Downloads/metahuman-studio-256x256.png win32/code_150x150.png
```

### Alternative: ImageMagick

If you have ImageMagick installed:

```bash
cd apps/code-oss/resources

# Generate all sizes
convert -background none metahuman-studio-icon.svg -resize 512x512 linux/metahuman-studio.png
convert -background none metahuman-studio-icon.svg -resize 512x512 server/code-512.png
convert -background none metahuman-studio-icon.svg -resize 192x192 server/code-192.png

# Create multi-resolution ICO
convert -background none metahuman-studio-icon.svg \
  \( -clone 0 -resize 16x16 \) \
  \( -clone 0 -resize 32x32 \) \
  \( -clone 0 -resize 48x48 \) \
  -delete 0 server/favicon.ico
```

### Alternative: Online Converter

1. Upload [metahuman-studio-icon.svg](resources/metahuman-studio-icon.svg) to https://cloudconvert.com/svg-to-png
2. Generate sizes: 16, 32, 48, 64, 128, 192, 256, 512
3. Download and place in correct directories

## 📁 Current Icon File Status

| File | Status | Notes |
|------|--------|-------|
| `resources/metahuman-studio-icon.svg` | ✅ Created | Master SVG source |
| `linux/metahuman-studio.png` | ⚠️  Placeholder | Replace with real icon |
| `server/code-512.png` | ⚠️  Placeholder | Replace with real icon |
| `server/code-192.png` | ⚠️  Placeholder | Replace with real icon |
| `server/favicon.ico` | ⚠️  Old VS Code | Replace with real icon |
| `win32/code_150x150.png` | ❌ Not created | Need to generate |
| `darwin/*.icns` | ❌ Not created | macOS only, see ICON-GENERATION.md |

## 🎨 Icon Design

The MetaHuman Studio icon features:
- **Dark background** (`#1a1a2e`) - Matches MetaHuman OS theme
- **Computer monitor** - Represents the development studio
- **Brain visualization** - Red/coral brain (`#e94560`) symbolizing AI intelligence
- **Neural pathways** - Stylized processing lines
- **Circuit accents** - Technology/computing elements

## 🔍 Verify Icons Are Working

After replacing the placeholder icons:

```bash
# View the icons
eog linux/metahuman-studio.png server/code-512.png

# Rebuild code-oss
cd apps/code-oss
npm run compile

# Launch and check window title/icon
./scripts/code-oss.sh
```

The window should show:
- Title: "MetaHuman Studio"
- Icon: Brain-in-computer design (not VS Code logo)

## 📚 Additional Resources

- **Full generation guide**: [ICON-GENERATION.md](resources/ICON-GENERATION.md)
- **Branding changes**: [METAHUMAN-STUDIO-BRANDING.md](METAHUMAN-STUDIO-BRANDING.md)
- **SVG source**: [metahuman-studio-icon.svg](resources/metahuman-studio-icon.svg)

## 🐛 Troubleshooting

**Icons not showing after rebuild?**
- Clear application cache: `rm -rf ~/.metahuman-studio/`
- Verify file names match product.json references
- Check file permissions: `chmod 644 *.png *.ico`

**SVG to PNG conversion not working?**
- Use online converter: https://cloudconvert.com/svg-to-png
- Or install ImageMagick: `sudo apt install imagemagick` (Linux)
- Or use macOS Preview: Open SVG, Export as PNG

**Want to customize the icon?**
- Edit `metahuman-studio-icon.svg` in Inkscape or similar vector editor
- Keep viewBox at `0 0 512 512`
- Re-generate PNG files after changes
