# MetaHuman OS Setup Process - Corrected Documentation

This document explains the correct way MetaHuman OS should be distributed and set up, without including heavy dependencies in the repository.

## Repository Distribution Model

### What IS Included in the Repository
- **Source code**: All TypeScript/JavaScript application code
- **Configuration templates**: Safe default configurations
- **Documentation**: README files, user guides, and instructions
- **Lightweight assets**: Small files, templates, and schemas
- **Setup scripts**: Automated installation and startup scripts
- **Requirements specification**: `requirements.txt` for Python dependencies

### What is NOT Included in the Repository
- **Virtual environment**: The 8.6GB Python virtual environment (`venv/`)
- **Machine learning models**: Large model files and checkpoints
- **User data**: Personal memories, conversations, and settings
- **Generated content**: Output files, logs, and temporary data
- **Heavy dependencies**: Binary packages and compiled libraries

## Correct Setup Process for Users

### 1. Clone the Repository
```bash
git clone <repository-url>
cd metahuman-os
```

### 2. Install System Requirements
Users must first install the required system tools:
- Node.js 18+
- pnpm 9+
- Python 3.8+
- Ollama (for local LLM)
- Whisper (for speech-to-text)
- Piper (for text-to-speech)

### 3. Run Automated Setup
The startup scripts automatically handle the rest:

**Linux/macOS:**
```bash
./start.sh
```

**Windows:**
Double-click `start.bat`

**Any platform with Python:**
```bash
python start.py
```

### 4. What the Setup Scripts Do
1. **Create virtual environment**: `python -m venv venv`
2. **Install Python dependencies**: `pip install -r requirements.txt`
3. **Install Node.js dependencies**: `pnpm install`
4. **Initialize MetaHuman OS**: `./bin/mh init`
5. **Start web interface**: `cd apps/site && pnpm dev`

## Benefits of This Approach

### For Repository Size
- **Lightweight**: Repository stays under 100MB instead of 8+ GB
- **Fast cloning**: Users can download in seconds, not hours
- **Easy maintenance**: No need to manage large binary files
- **Bandwidth friendly**: Minimal data transfer for updates

### For Users
- **Fresh environment**: Gets latest package versions for security
- **Platform appropriate**: Installs correct binaries for their system
- **Disk space control**: Can choose where to install large dependencies
- **Update flexibility**: Can easily update individual packages

### For Development
- **Version control**: Clean repository without binary noise
- **Collaboration**: Team members get consistent setup process
- **CI/CD friendly**: Automated testing with fresh environments
- **Reproducible**: Everyone gets the same dependency versions

## Virtual Environment Management

### Creation
The startup scripts automatically create a virtual environment:
```bash
python3 -m venv venv
```

### Activation
Scripts automatically activate the virtual environment:
```bash
source venv/bin/activate  # Linux/macOS
# or
venv\Scripts\activate.bat  # Windows
```

### Package Installation
Dependencies are installed from `requirements.txt`:
```bash
pip install -r requirements.txt
```

### Size Considerations
The virtual environment is approximately 8.6GB due to:
- PyTorch (2-3GB)
- Transformers library (1-2GB)
- Various ML/AI packages (3-4GB)
- Dependencies and caches (1-2GB)

## .gitignore Configuration

The `.gitignore` file properly excludes:
```
/venv/              # Python virtual environment
.env                # Environment variables
/out/               # Generated output
/logs/              # Log files
/memory/episodic/   # Personal memories
/node_modules/      # Node.js dependencies
```

## Requirements Management

### Python Dependencies
- **Specification**: `requirements.txt` lists all packages with versions
- **Installation**: `pip install -r requirements.txt`
- **Updates**: Can easily upgrade individual packages
- **Security**: Gets latest security patches

### Node.js Dependencies
- **Specification**: `package.json` lists all packages
- **Installation**: `pnpm install`
- **Lock file**: `pnpm-lock.yaml` ensures reproducible installs

## User Data Protection

### Personal Information
All personal data is excluded from the repository:
- Memories and conversations (`/memory/episodic/`)
- Personal settings (`/persona/`)
- Task lists (`/memory/tasks/`)
- Logs and audit trails (`/logs/`)

### Template System
Safe templates are included for initialization:
- `persona/core.json.template`
- Configuration file templates
- Schema definitions

## Deployment Scenarios

### Development Setup
1. Clone repository
2. Run `./start.sh`
3. Customize persona files
4. Begin development

### Production Deployment
1. Clone repository
2. Create virtual environment manually
3. Install dependencies
4. Configure for production
5. Deploy with process manager

### CI/CD Pipeline
1. Fresh clone for each build
2. Automated dependency installation
3. Testing with clean environment
4. Artifact deployment

## Troubleshooting

### Common Issues
1. **Missing system tools**: Install Node.js, Python, pnpm
2. **Permission errors**: Run with appropriate privileges
3. **Network issues**: Check internet connectivity
4. **Disk space**: Ensure 10GB+ free space for dependencies

### Diagnostic Commands
```bash
# Check system tools
node --version
python --version
pnpm --version

# Check virtual environment
ls -la venv/

# Check installed packages
pip list
```

This approach ensures MetaHuman OS is distributed efficiently while providing users with a seamless setup experience.