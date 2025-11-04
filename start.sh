#!/bin/bash

# MetaHuman OS Startup Script
# This script initializes and starts the MetaHuman OS web interface

set -e  # Exit on any error

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}================================${NC}"
echo -e "${BLUE}  MetaHuman OS Startup Script  ${NC}"
echo -e "${BLUE}================================${NC}"
echo

# Function to print status messages
print_status() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}!${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to check if a process is running
is_running() {
    pgrep -f "$1" >/dev/null 2>&1
}

# Check if we're in the right directory structure
if [ ! -f "$REPO_ROOT/package.json" ] || [ ! -d "$REPO_ROOT/apps/site" ]; then
    print_error "This script must be run from the MetaHuman OS root directory"
    print_error "Current directory: $REPO_ROOT"
    print_error "Make sure package.json and apps/site/ exist"
    exit 1
fi

echo "Repository root: $REPO_ROOT"
echo

# Check for required tools
echo "Checking for required tools..."
REQUIRED_TOOLS=("node" "pnpm" "python3")

MISSING_TOOLS=()
for tool in "${REQUIRED_TOOLS[@]}"; do
    if command_exists "$tool"; then
        VERSION=$($tool --version 2>/dev/null || echo "unknown")
        print_status "$tool ($VERSION)"
    else
        MISSING_TOOLS+=("$tool")
    fi
done

if [ ${#MISSING_TOOLS[@]} -ne 0 ]; then
    echo
    print_error "Missing required tools: ${MISSING_TOOLS[*]}"
    print_warning "Please install the following:"
    for tool in "${MISSING_TOOLS[@]}"; do
        case "$tool" in
            "node")
                echo "  - Node.js (https://nodejs.org/)"
                ;;
            "pnpm")
                echo "  - pnpm (npm install -g pnpm)"
                ;;
            "python3")
                echo "  - Python 3 (https://www.python.org/downloads/)"
                ;;
        esac
    done
    exit 1
fi

echo

# Create and setup Python virtual environment if it doesn't exist
VENV_PATH="$REPO_ROOT/venv"
if [ ! -d "$VENV_PATH" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv "$VENV_PATH"
    print_status "Virtual environment created at $VENV_PATH"
    echo
fi

# Activate virtual environment
echo "Activating Python virtual environment..."
source "$VENV_PATH/bin/activate"
print_status "Virtual environment activated ($(basename $VIRTUAL_ENV))"
echo

# Install Python dependencies if requirements.txt exists
if [ -f "$REPO_ROOT/requirements.txt" ]; then
    echo "Checking Python dependencies..."
    if [ ! -f "$VENV_PATH/installed_packages" ] || [ "$REPO_ROOT/requirements.txt" -nt "$VENV_PATH/installed_packages" ]; then
        echo "Installing Python dependencies from requirements.txt..."
        pip install --upgrade pip setuptools wheel
        pip install -r "$REPO_ROOT/requirements.txt"
        touch "$VENV_PATH/installed_packages"
        print_status "Python dependencies installed"
        echo
    else
        print_status "Python dependencies already installed"
        echo
    fi
else
    print_warning "requirements.txt not found - skipping Python dependency installation"
    echo
fi

# Check if Ollama is running
echo "Checking Ollama status..."
if command_exists "ollama" && ollama list >/dev/null 2>&1; then
    print_status "Ollama is running"
else
    print_warning "Ollama is not running or not installed"
    print_warning "The web interface may have limited functionality"
    print_warning "Install Ollama from: https://ollama.ai"
    echo
fi

# Check if we need to install Node.js dependencies
echo "Checking for Node.js dependencies..."
if [ ! -d "$REPO_ROOT/node_modules" ] || [ ! -d "$REPO_ROOT/apps/site/node_modules" ]; then
    echo "Installing Node.js dependencies..."
    cd "$REPO_ROOT"
    pnpm install
    print_status "Dependencies installed"
    echo
else
    print_status "Node.js dependencies already installed"
    echo
fi

# Check if MetaHuman is initialized
echo "Checking MetaHuman initialization..."
PERSONA_CORE="$REPO_ROOT/persona/core.json"
if [ ! -f "$PERSONA_CORE" ]; then
    print_warning "MetaHuman not initialized"
    echo "Initializing MetaHuman OS..."
    cd "$REPO_ROOT"
    ./bin/mh init
    print_status "MetaHuman initialized"
    echo
    print_warning "Remember to customize your persona in persona/core.json"
else
    print_status "MetaHuman already initialized"
    echo
fi

# Function to stop existing processes
stop_existing() {
    echo "Checking for existing processes..."
    
    # Kill any existing Astro dev servers
    if is_running "astro dev"; then
        echo "Stopping existing Astro dev server..."
        pkill -f "astro dev" 2>/dev/null || true
        sleep 2
    fi
    
    # Kill any existing mh agents
    if is_running "mh agent"; then
        echo "Stopping existing MetaHuman agents..."
        ./bin/mh agent stop --all 2>/dev/null || true
        sleep 2
    fi
    
    print_status "Existing processes stopped"
    echo
}

# Stop existing processes
stop_existing

# Start the web server
echo "Starting MetaHuman OS web interface..."
echo

cd "$REPO_ROOT/apps/site"

print_status "Starting development server..."
print_status "Web interface will be available at: http://localhost:4321"
echo

# Display helpful information
echo "=========================================="
echo "  MetaHuman OS Web Interface Starting     "
echo "=========================================="
echo "URL: http://localhost:4321"
echo "Press Ctrl+C to stop the server"
echo
echo "Features available:"
echo "  - Chat with your digital personality"
echo "  - Task management"
echo "  - Memory browsing"
echo "  - Persona customization"
echo "  - Agent monitoring"
echo
echo "To stop the server, press Ctrl+C"
echo "=========================================="
echo

# Start the development server
exec pnpm dev