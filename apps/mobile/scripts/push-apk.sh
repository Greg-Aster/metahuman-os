#!/bin/bash
#
# Push APK to connected Android device
# Usage: ./push-apk.sh [build]
#   - No args: Just push existing APK
#   - build: Build first, then push
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_DIR="$(dirname "$SCRIPT_DIR")"
APK_PATH="$MOBILE_DIR/android/app/build/outputs/apk/debug/app-debug.apk"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  MetaHuman Mobile APK Pusher${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check for ADB
if ! command -v adb &> /dev/null; then
    echo -e "${RED}Error: adb not found${NC}"
    echo "Install Android SDK Platform Tools:"
    echo "  sudo apt install adb"
    exit 1
fi

# Build if requested
if [ "$1" == "build" ]; then
    echo -e "${BLUE}[1/3] Building APK...${NC}"
    "$SCRIPT_DIR/build-mobile.sh"

    # Rebuild server after mobile build (they share dist/)
    echo ""
    echo -e "${BLUE}[2/3] Rebuilding server...${NC}"
    cd "$MOBILE_DIR/../site"
    pnpm build
    echo -e "${GREEN}✓ Server rebuilt${NC}"
else
    echo -e "${YELLOW}Skipping build (use './push-apk.sh build' to build first)${NC}"
fi

# Check if APK exists
if [ ! -f "$APK_PATH" ]; then
    echo -e "${RED}Error: APK not found at $APK_PATH${NC}"
    echo "Run './push-apk.sh build' to build first"
    exit 1
fi

# Check for connected devices
echo ""
echo -e "${BLUE}Checking for connected devices...${NC}"
DEVICES=$(adb devices | grep -v "List" | grep -v "^$" | grep "device$" || true)

if [ -z "$DEVICES" ]; then
    # Try wireless devices
    echo -e "${YELLOW}No USB devices found. Checking for wireless ADB...${NC}"

    # Common local IPs to try
    WIRELESS_FOUND=false
    for ip in 192.168.0.{1..254} 192.168.1.{1..254}; do
        if timeout 0.1 adb connect "$ip:5555" &>/dev/null; then
            if adb devices | grep -q "$ip:5555.*device"; then
                echo -e "${GREEN}✓ Found wireless device at $ip:5555${NC}"
                WIRELESS_FOUND=true
                break
            fi
        fi
    done 2>/dev/null

    if [ "$WIRELESS_FOUND" = false ]; then
        echo ""
        echo -e "${RED}No devices found!${NC}"
        echo ""
        echo "To connect via USB:"
        echo "  1. Enable USB Debugging on your phone"
        echo "  2. Connect via USB cable"
        echo "  3. Accept the USB debugging prompt on your phone"
        echo ""
        echo "To connect wirelessly (one-time USB setup):"
        echo "  1. Connect phone via USB"
        echo "  2. Run: adb tcpip 5555"
        echo "  3. Disconnect USB"
        echo "  4. Run: adb connect <your-phone-ip>:5555"
        exit 1
    fi
fi

# Get device info
DEVICE_NAME=$(adb shell getprop ro.product.model 2>/dev/null || echo "Unknown")
echo -e "${GREEN}✓ Found device: $DEVICE_NAME${NC}"

# Install APK
echo ""
APK_SIZE=$(du -h "$APK_PATH" | cut -f1)
echo -e "${BLUE}Installing APK ($APK_SIZE)...${NC}"
adb install -r "$APK_PATH"

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  APK Installed Successfully!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "  Device: ${YELLOW}$DEVICE_NAME${NC}"
echo -e "  APK Size: ${YELLOW}$APK_SIZE${NC}"
echo ""
echo -e "  ${BLUE}Tip:${NC} The app should auto-launch or find it in your app drawer"
echo ""
