# MetaHuman Studio Icon Generation Guide

This directory contains the source SVG icon and scripts to generate all required icon formats.

## Source Files

- **metahuman-studio-icon.svg** - Master SVG source file (512x512)
  - Brain-in-computer design
  - Dark theme colors (#1a1a2e background, #e94560 brain)
  - Scalable to any size

## Quick Start

### Option 1: Using Node.js (Recommended)

```bash
# Install sharp image processing library
npm install sharp

# Run the icon generator script
node generate-icons.js
```

This will create:
- `linux/metahuman-studio.png` (512x512)
- `server/code-512.png` (512x512)
- `server/code-192.png` (192x192)
- `win32/code_150x150.png` (256x256)
- `temp-icons/*` (all sizes for ICO/ICNS creation)

### Option 2: Using ImageMagick

```bash
# Convert SVG to PNG in various sizes
convert -background none metahuman-studio-icon.svg -resize 512x512 linux/metahuman-studio.png
convert -background none metahuman-studio-icon.svg -resize 192x192 server/code-192.png
convert -background none metahuman-studio-icon.svg -resize 512x512 server/code-512.png

# Create Windows ICO file (multi-resolution)
convert -background none metahuman-studio-icon.svg \
  \( -clone 0 -resize 16x16 \) \
  \( -clone 0 -resize 32x32 \) \
  \( -clone 0 -resize 48x48 \) \
  \( -clone 0 -resize 64x64 \) \
  \( -clone 0 -resize 128x128 \) \
  \( -clone 0 -resize 256x256 \) \
  -delete 0 server/favicon.ico
```

### Option 3: Online Converters

If you don't have command-line tools:

1. **PNG Generation:**
   - Upload `metahuman-studio-icon.svg` to https://cloudconvert.com/svg-to-png
   - Select output sizes: 16, 32, 48, 64, 128, 192, 256, 512
   - Download and rename files as needed

2. **ICO Creation:**
   - Upload PNG files to https://www.icoconverter.com/
   - Combine sizes: 16, 32, 48, 64, 128, 256
   - Save as `favicon.ico`

3. **macOS ICNS:**
   - Upload PNG files to https://cloudconvert.com/png-to-icns
   - Or use macOS iconutil (see below)

## Required Icon Files

### Linux
- `linux/metahuman-studio.png` (512x512 PNG)
  - Used as application icon
  - Referenced in product.json as `linuxIconName: "metahuman-studio"`

### Server/Web
- `server/code-512.png` (512x512 PNG)
- `server/code-192.png` (192x192 PNG)
- `server/favicon.ico` (multi-size ICO: 16, 32, 48)

### Windows
- `win32/code_150x150.png` (256x256 PNG, legacy)
- `win32/*.ico` (optional, file type association icons)

### macOS
- `darwin/*.icns` (Apple Icon Image format)
  - Contains multiple resolutions (16, 32, 64, 128, 256, 512, 1024)

## macOS ICNS Creation

### Using iconutil (macOS only)

```bash
# Create iconset directory
mkdir metahuman-studio.iconset

# Generate required sizes
sips -z 16 16     metahuman-studio-icon.svg --out metahuman-studio.iconset/icon_16x16.png
sips -z 32 32     metahuman-studio-icon.svg --out metahuman-studio.iconset/icon_16x16@2x.png
sips -z 32 32     metahuman-studio-icon.svg --out metahuman-studio.iconset/icon_32x32.png
sips -z 64 64     metahuman-studio-icon.svg --out metahuman-studio.iconset/icon_32x32@2x.png
sips -z 128 128   metahuman-studio-icon.svg --out metahuman-studio.iconset/icon_128x128.png
sips -z 256 256   metahuman-studio-icon.svg --out metahuman-studio.iconset/icon_128x128@2x.png
sips -z 256 256   metahuman-studio-icon.svg --out metahuman-studio.iconset/icon_256x256.png
sips -z 512 512   metahuman-studio-icon.svg --out metahuman-studio.iconset/icon_256x256@2x.png
sips -z 512 512   metahuman-studio-icon.svg --out metahuman-studio.iconset/icon_512x512.png
sips -z 1024 1024 metahuman-studio-icon.svg --out metahuman-studio.iconset/icon_512x512@2x.png

# Convert to ICNS
iconutil -c icns metahuman-studio.iconset -o darwin/metahuman-studio.icns

# Clean up
rm -rf metahuman-studio.iconset
```

## Icon Design Details

The MetaHuman Studio icon features:
- **Computer monitor** - Represents the development/studio environment
- **Brain visualization** - Symbolizes the AI/MetaHuman intelligence
- **Neural pathways** - Stylized lines showing cognitive processing
- **Circuit board accents** - Technology/computer science elements
- **Dark theme colors** - Matches MetaHuman OS aesthetic
  - Background: `#1a1a2e` (dark blue-gray)
  - Screen: `#16213e` (navy)
  - Brain: `#e94560` (coral red)
  - Accents: `#f56476` (light coral)

## Customizing the Icon

To modify the icon design:

1. Edit `metahuman-studio-icon.svg` in a vector editor (Inkscape, Adobe Illustrator, etc.)
2. Keep the viewBox at `0 0 512 512` for consistency
3. Use the established color palette for brand consistency
4. Re-run the generation scripts after changes

## Verification

After generating icons, verify:

```bash
# Check file sizes
ls -lh linux/*.png server/*.png win32/*.png

# View the icons (Linux)
eog linux/metahuman-studio.png server/code-512.png

# macOS
open linux/metahuman-studio.png

# Windows
start linux/metahuman-studio.png
```

## Troubleshooting

### Sharp installation fails
```bash
# Try installing with native dependencies
npm install --build-from-source sharp

# Or use pre-built binaries
npm install --platform=linux --arch=x64 sharp
```

### SVG rendering issues
- Ensure SVG viewBox is set correctly: `viewBox="0 0 512 512"`
- Check that all paths are closed and valid
- Validate SVG at https://validator.w3.org/

### Icon not showing in application
- Verify file names match product.json references
- Rebuild the application after adding new icons
- Clear application cache: `rm -rf ~/.metahuman-studio/`
- Check console for file loading errors

## Next Steps

After generating all icons:

1. Copy icons to their final locations
2. Rebuild MetaHuman Studio: `npm run compile`
3. Test the application and verify icons appear correctly
4. Update this documentation if you improve the icon design
