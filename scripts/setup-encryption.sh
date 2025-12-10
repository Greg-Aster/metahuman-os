#!/bin/bash
#
# MetaHuman OS - Encryption Setup Script
#
# This script configures the system to allow MetaHuman OS to manage
# LUKS encrypted profiles without password prompts.
#
# Run with: sudo ./scripts/setup-encryption.sh
#
# What it does:
#   1. Installs polkit policy (defines allowed actions)
#   2. Installs polkit rules (enables passwordless operation)
#   3. Installs helper script (validates and executes commands)
#   4. Creates 'metahuman' group
#   5. Adds current user to the group
#
# After running this script, log out and back in for the group
# membership to take effect.
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Error: This script must be run with sudo${NC}"
    echo "Usage: sudo $0"
    exit 1
fi

# Get the actual user (not root)
if [ -n "$SUDO_USER" ]; then
    ACTUAL_USER="$SUDO_USER"
else
    ACTUAL_USER=$(logname 2>/dev/null || echo "$USER")
fi

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
POLKIT_DIR="$SCRIPT_DIR/polkit"

echo "=============================================="
echo "  MetaHuman OS - Encryption Setup"
echo "=============================================="
echo ""

# Check for required files
if [ ! -d "$POLKIT_DIR" ]; then
    echo -e "${RED}Error: polkit directory not found at $POLKIT_DIR${NC}"
    exit 1
fi

# Check if polkit is installed
if ! command -v pkexec &> /dev/null; then
    echo -e "${YELLOW}Warning: polkit (pkexec) not found${NC}"
    echo "Installing polkit..."
    if command -v apt-get &> /dev/null; then
        apt-get update && apt-get install -y policykit-1
    elif command -v dnf &> /dev/null; then
        dnf install -y polkit
    elif command -v pacman &> /dev/null; then
        pacman -S --noconfirm polkit
    else
        echo -e "${RED}Error: Could not install polkit. Please install it manually.${NC}"
        exit 1
    fi
fi

# Check if cryptsetup is installed
if ! command -v cryptsetup &> /dev/null; then
    echo -e "${YELLOW}Warning: cryptsetup not found${NC}"
    echo "Installing cryptsetup..."
    if command -v apt-get &> /dev/null; then
        apt-get update && apt-get install -y cryptsetup
    elif command -v dnf &> /dev/null; then
        dnf install -y cryptsetup
    elif command -v pacman &> /dev/null; then
        pacman -S --noconfirm cryptsetup
    else
        echo -e "${RED}Error: Could not install cryptsetup. Please install it manually.${NC}"
        exit 1
    fi
fi

echo "Step 1/5: Installing polkit policy..."
cp "$POLKIT_DIR/com.metahuman.luks.policy" /usr/share/polkit-1/actions/
chmod 644 /usr/share/polkit-1/actions/com.metahuman.luks.policy
echo -e "${GREEN}✓ Policy installed${NC}"

echo "Step 2/5: Installing polkit rules..."
cp "$POLKIT_DIR/50-metahuman-luks.rules" /etc/polkit-1/rules.d/
chmod 644 /etc/polkit-1/rules.d/50-metahuman-luks.rules
echo -e "${GREEN}✓ Rules installed${NC}"

echo "Step 3/5: Installing helper script..."
cp "$POLKIT_DIR/metahuman-luks-helper" /usr/local/bin/
chmod 755 /usr/local/bin/metahuman-luks-helper
echo -e "${GREEN}✓ Helper script installed${NC}"

echo "Step 4/5: Creating metahuman group..."
if getent group metahuman > /dev/null 2>&1; then
    echo -e "${YELLOW}Group 'metahuman' already exists${NC}"
else
    groupadd metahuman
    echo -e "${GREEN}✓ Group created${NC}"
fi

echo "Step 5/5: Adding $ACTUAL_USER to metahuman group..."
if id -nG "$ACTUAL_USER" | grep -qw "metahuman"; then
    echo -e "${YELLOW}User '$ACTUAL_USER' is already in metahuman group${NC}"
else
    usermod -aG metahuman "$ACTUAL_USER"
    echo -e "${GREEN}✓ User added to group${NC}"
fi

# Restart polkit to apply changes
echo ""
echo "Restarting polkit service..."
if systemctl is-active --quiet polkit; then
    systemctl restart polkit
    echo -e "${GREEN}✓ Polkit restarted${NC}"
else
    echo -e "${YELLOW}Polkit service not running (may be socket-activated)${NC}"
fi

echo ""
echo "=============================================="
echo -e "${GREEN}  Setup Complete!${NC}"
echo "=============================================="
echo ""
echo "IMPORTANT: You must log out and log back in for"
echo "the group membership to take effect."
echo ""
echo "After logging back in, MetaHuman OS will be able"
echo "to manage encrypted profiles automatically."
echo ""
echo "To verify the setup, run:"
echo "  groups $ACTUAL_USER"
echo ""
echo "You should see 'metahuman' in the list."
echo ""
