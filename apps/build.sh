#!/bin/bash
#
# Unified Build Script for MetaHuman OS
# For those who don't want to remember which command does what
#
# IMPORTANT: Server and Mobile builds share apps/site/dist/
# - Server build creates SSR output (needed for ./start.sh)
# - Mobile build creates static output (bundled into APK)
# When building both, we build Mobile FIRST, then Server LAST
# so that ./start.sh works immediately after.
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  MetaHuman OS Build System${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

show_menu() {
    echo "What do you want to build?"
    echo ""
    echo -e "  ${GREEN}1)${NC} Server only     - Build for ./start.sh"
    echo -e "  ${GREEN}2)${NC} Mobile only     - Build APK for Android ${YELLOW}(will break ./start.sh)${NC}"
    echo -e "  ${GREEN}3)${NC} Both            - Mobile APK + Server ${YELLOW}(recommended)${NC}"
    echo ""
    echo -e "  ${YELLOW}0)${NC} Exit"
    echo ""
}

build_server() {
    echo ""
    echo -e "${BLUE}[Server]${NC} Building production server..."
    cd "$SCRIPT_DIR/site"
    pnpm build
    echo -e "${GREEN}✓ Server build complete${NC}"
    echo "  Run with: ./start.sh"
}

build_mobile() {
    echo ""
    echo -e "${BLUE}[Mobile]${NC} Building Android APK..."
    cd "$SCRIPT_DIR/mobile"
    ./scripts/build-mobile.sh
    echo -e "${GREEN}✓ Mobile build complete${NC}"
}

build_mobile_with_warning() {
    echo ""
    echo -e "${YELLOW}⚠ WARNING: Mobile build overwrites apps/site/dist/${NC}"
    echo -e "${YELLOW}  After this, ./start.sh will NOT work until you rebuild server.${NC}"
    echo ""
    read -p "Continue? [y/N]: " confirm
    if [[ "$confirm" =~ ^[Yy]$ ]]; then
        build_mobile
        echo ""
        echo -e "${YELLOW}⚠ Remember: Run './build.sh server' to restore ./start.sh functionality${NC}"
    else
        echo "Cancelled."
    fi
}

build_both() {
    echo ""
    echo -e "${BLUE}Building both Mobile and Server...${NC}"
    echo -e "${YELLOW}  Order: Mobile first → Server last (so ./start.sh works)${NC}"
    echo ""

    # Build mobile first (will overwrite dist/)
    build_mobile

    echo ""
    echo -e "${BLUE}Mobile APK is ready. Now rebuilding server...${NC}"

    # Rebuild server last (restores SSR output for ./start.sh)
    build_server
}

# Check for command line argument
if [ -n "$1" ]; then
    case "$1" in
        server|1)
            build_server
            exit 0
            ;;
        mobile|2)
            build_mobile_with_warning
            exit 0
            ;;
        both|all|3)
            build_both
            exit 0
            ;;
        *)
            echo "Usage: $0 [server|mobile|both]"
            echo ""
            echo "  server  - Build production server (for ./start.sh)"
            echo "  mobile  - Build Android APK (warning: overwrites server build)"
            echo "  both    - Build Mobile APK + Server (recommended)"
            exit 1
            ;;
    esac
fi

# Interactive menu
while true; do
    show_menu
    read -p "Enter choice [0-3]: " choice

    case $choice in
        1)
            build_server
            break
            ;;
        2)
            build_mobile_with_warning
            break
            ;;
        3)
            build_both
            break
            ;;
        0)
            echo "Bye!"
            exit 0
            ;;
        *)
            echo -e "${RED}Invalid option. Try again.${NC}"
            echo ""
            ;;
    esac
done

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Build Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
