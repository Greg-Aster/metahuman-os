#!/usr/bin/env python3
"""
Simple SVG to PNG converter using PIL for basic icon generation.
This creates a simple colored placeholder since we can't render SVG directly.
"""

import os
from PIL import Image, ImageDraw

# MetaHuman Studio colors
BG_COLOR = (26, 26, 46)  # #1a1a2e
BRAIN_COLOR = (233, 69, 96)  # #e94560

def create_placeholder_icon(size, output_path):
    """Create a simple placeholder icon with MetaHuman colors."""
    img = Image.new('RGBA', (size, size), BG_COLOR + (255,))
    draw = ImageDraw.Draw(img)

    # Draw a simple circle to represent the brain concept
    margin = size // 4
    draw.ellipse([margin, margin, size-margin, size-margin],
                 fill=BRAIN_COLOR + (255,), outline=(195, 61, 84, 255), width=max(2, size//64))

    # Save the image
    img.save(output_path, 'PNG')
    print(f"✓ Created {size}x{size} PNG: {output_path}")

def main():
    print("🎨 MetaHuman Studio Simple Icon Generator")
    print("Creating placeholder icons with MetaHuman colors...\n")

    resources_dir = os.path.dirname(os.path.abspath(__file__))

    # Generate icons
    icons = [
        (512, os.path.join(resources_dir, 'linux', 'metahuman-studio.png')),
        (512, os.path.join(resources_dir, 'server', 'code-512.png')),
        (192, os.path.join(resources_dir, 'server', 'code-192.png')),
        (256, os.path.join(resources_dir, 'win32', 'code_150x150.png')),
    ]

    for size, path in icons:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        create_placeholder_icon(size, path)

    print("\n✓ Basic icons created!")
    print("\nNote: These are simple placeholders.")
    print("For the full SVG design, use ./generate-pngs.sh (browser-based tool)")
    print("or upload resources/metahuman-studio-icon.svg to https://cloudconvert.com/svg-to-png")

if __name__ == '__main__':
    main()
