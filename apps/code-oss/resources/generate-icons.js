#!/usr/bin/env node
/**
 * MetaHuman Studio Icon Generator
 *
 * Converts the SVG icon to PNG files in various sizes needed for the application.
 *
 * Usage:
 *   npm install sharp  # Install dependency first
 *   node generate-icons.js
 */

const fs = require('fs');
const path = require('path');

// Check if sharp is available
let sharp;
try {
  sharp = require('sharp');
} catch (error) {
  console.error('Error: sharp is not installed.');
  console.error('Please run: npm install sharp');
  console.error('Or use the alternative method documented in ICON-GENERATION.md');
  process.exit(1);
}

const SVG_SOURCE = path.join(__dirname, 'metahuman-studio-icon.svg');
const OUTPUT_DIRS = {
  linux: path.join(__dirname, 'linux'),
  server: path.join(__dirname, 'server'),
  win32: path.join(__dirname, 'win32'),
};

// Ensure output directories exist
Object.values(OUTPUT_DIRS).forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Icon sizes to generate
const SIZES = [
  { size: 16, name: 'icon-16' },
  { size: 32, name: 'icon-32' },
  { size: 48, name: 'icon-48' },
  { size: 64, name: 'icon-64' },
  { size: 128, name: 'icon-128' },
  { size: 192, name: 'icon-192' },
  { size: 256, name: 'icon-256' },
  { size: 512, name: 'icon-512' },
];

async function generateIcons() {
  console.log('🎨 MetaHuman Studio Icon Generator\n');

  // Read SVG source
  const svgBuffer = fs.readFileSync(SVG_SOURCE);

  // Generate PNG files for each size
  for (const { size, name } of SIZES) {
    console.log(`Generating ${size}x${size} PNG...`);

    try {
      const pngBuffer = await sharp(svgBuffer)
        .resize(size, size)
        .png()
        .toBuffer();

      // Save to various locations as needed

      // Linux app icon (main icon)
      if (size === 512) {
        fs.writeFileSync(path.join(OUTPUT_DIRS.linux, 'metahuman-studio.png'), pngBuffer);
        console.log(`  ✓ Saved to linux/metahuman-studio.png`);
      }

      // Server icons
      if (size === 512 || size === 192) {
        fs.writeFileSync(path.join(OUTPUT_DIRS.server, `code-${size}.png`), pngBuffer);
        console.log(`  ✓ Saved to server/code-${size}.png`);
      }

      // Windows icon (keeping for now, ICO needs special handling)
      if (size === 256) {
        fs.writeFileSync(path.join(OUTPUT_DIRS.win32, 'code_150x150.png'), pngBuffer);
        console.log(`  ✓ Saved to win32/code_150x150.png`);
      }

      // Save all sizes to a temp directory for ICO creation
      const tempDir = path.join(__dirname, 'temp-icons');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      fs.writeFileSync(path.join(tempDir, `${name}-${size}.png`), pngBuffer);

    } catch (error) {
      console.error(`  ✗ Error generating ${size}x${size}: ${error.message}`);
    }
  }

  console.log('\n✓ PNG generation complete!');
  console.log('\nNext steps:');
  console.log('1. For Windows ICO: Use online tool or ImageMagick to combine PNGs');
  console.log('   Example: convert temp-icons/*.png server/favicon.ico');
  console.log('2. For macOS ICNS: Use iconutil or online converter');
  console.log('3. Check ICON-GENERATION.md for detailed instructions');
}

generateIcons().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
