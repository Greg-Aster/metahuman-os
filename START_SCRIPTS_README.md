# MetaHuman OS Startup Scripts

This directory contains multiple startup scripts to make it easy to run MetaHuman OS. Choose the one that best fits your needs and platform.

## Available Startup Scripts

### 1. `start.sh` - Bash Script (Linux/macOS)
A comprehensive bash script that handles all startup tasks:
- Checks for required tools
- Verifies Ollama status
- Activates Python virtual environment
- Installs dependencies if needed
- Initializes MetaHuman OS if not already set up
- Starts the web interface

**Usage:**
```bash
./start.sh
```

### 2. `start.bat` - Batch Script (Windows)
Windows-compatible batch file with similar functionality to the bash script:
- Checks for required tools
- Verifies Ollama status
- Activates Python virtual environment
- Installs dependencies if needed
- Initializes MetaHuman OS if not already set up
- Starts the web interface

**Usage:**
Double-click `start.bat` or run from Command Prompt:
```cmd
start.bat
```

### 3. `start.py` - Python Script (Cross-platform)
A Python-based startup script with a guided interface:
- Cross-platform compatibility
- Colorful terminal output
- Interactive prompts
- Detailed status reporting
- Automatic virtual environment activation

**Usage:**
```bash
python start.py
```

## What Each Script Does

1. **Environment Check**
   - Verifies Node.js, pnpm, and Python are installed
   - Checks Ollama status and availability
   - Activates Python virtual environment if it exists

2. **Dependency Management**
   - Automatically installs Node.js dependencies if missing
   - Ensures all packages are up to date

3. **Initialization**
   - Sets up MetaHuman OS directory structure if needed
   - Creates persona files from templates if they don't exist
   - Performs first-time setup tasks

4. **Web Server Startup**
   - Navigates to the correct directory (`apps/site`)
   - Starts the development server with `pnpm dev`
   - Provides clear URLs and instructions

## Quick Start

### Linux/macOS:
```bash
./start.sh
```

### Windows:
Double-click `start.bat` or run:
```cmd
start.bat
```

### Any Platform with Python:
```bash
python start.py
```

## Python Virtual Environment

MetaHuman OS includes a pre-configured Python virtual environment:
- **Location**: `./venv/` (automatically activated by startup scripts)
- **Packages**: Over 200 ML/AI packages including PyTorch, Transformers, etc.
- **Isolation**: Completely self-contained, no system Python interference
- **Activation**: Startup scripts automatically activate the virtual environment

### Virtual Environment Benefits
- **No system modifications**: All dependencies stay within the project directory
- **Version control**: Exact package versions ensured through `requirements.txt`
- **Reproducible**: Anyone gets the same environment
- **Easy cleanup**: Delete the folder to completely remove everything
- **Portable**: Move the entire directory to another machine

## Manual Startup (Alternative)

If you prefer to start manually:

```bash
# Navigate to the web interface directory
cd apps/site

# Start the development server
pnpm dev

# Open your browser to http://localhost:4321
```

## Requirements

- **Node.js** 18+ - https://nodejs.org/
- **pnpm** 9+ - Install with `npm install -g pnpm`
- **Ollama** (optional but recommended) - https://ollama.ai/
- **Python** 3.8+ (virtual environment already included)

## Troubleshooting

### "Command not found" errors
Make sure Node.js and pnpm are installed and in your PATH:
```bash
node --version
pnpm --version
```

### Permission denied
On Linux/macOS, make the script executable:
```bash
chmod +x start.sh
```

### Missing dependencies
The scripts will automatically install dependencies, but you can manually install with:
```bash
pnpm install
```

### Virtual Environment Issues
If you encounter Python package issues:
```bash
# Activate virtual environment manually
source venv/bin/activate  # Linux/macOS
# or
venv\Scripts\activate.bat  # Windows

# Reinstall requirements
pip install -r requirements.txt
```

## Customization

You can modify any of these scripts to suit your specific needs:
- Add custom environment variables
- Include additional setup steps
- Change port numbers
- Add custom logging

The scripts are designed to be easily customizable while providing a smooth out-of-the-box experience.