# MetaHuman OS Startup Options Summary

This document summarizes all the available ways to start MetaHuman OS, from simple to advanced.

## Quick Start Options (Recommended for Most Users)

### 1. Platform-Specific Startup Scripts

#### Linux/macOS Users
```bash
./start.sh
```
Features:
- Comprehensive environment checking
- Automatic dependency installation
- Initialization if needed
- Web server startup

#### Windows Users
Double-click `start.bat` or run:
```cmd
start.bat
```
Features:
- Windows-compatible batch script
- Same functionality as bash version
- Automatic tool checking

#### Cross-Platform (Any OS with Python)
```bash
python start.py
```
Features:
- Guided interface with colorful output
- Interactive prompts
- Works on any platform with Python 3.8+

## Manual Startup Methods

### Method 1: Direct Web Server Start
For users who have already set up their environment:

```bash
cd apps/site
pnpm dev
# Open http://localhost:4321
```

### Method 2: Full Manual Process
For advanced users who want complete control:

```bash
# 1. Ensure dependencies are installed
pnpm install

# 2. Initialize MetaHuman OS (if not already done)
./bin/mh init

# 3. Check system status
./bin/mh status

# 4. Start web server
cd apps/site
pnpm dev
# Open http://localhost:4321
```

### Method 3: Command Line Only
For users who prefer CLI interaction:

```bash
# Initialize (if needed)
./bin/mh init

# Check status
./bin/mh status

# Run specific commands
./bin/mh task
./bin/mh agent list
./bin/mh remember "search query"

# Chat directly
./bin/mh chat
```

## Advanced Startup Configurations

### Development Workflow
For developers working on MetaHuman OS:

```bash
# Start agents in separate terminals
./bin/mh agent run organizer
./bin/mh agent run boredom-service
./bin/mh agent run sleep-service

# Start web interface
cd apps/site
pnpm dev

# Monitor agents
./bin/mh agent monitor
```

### Production-Like Setup
For users who want a more permanent setup:

```bash
# Create systemd service (Linux)
# Create launchd agent (macOS)
# Use PM2 or similar process managers
```

## Environment Variables and Configuration

### Common Customizations
```bash
# Set custom port
PORT=3000 pnpm dev

# Use specific Ollama model
OLLAMA_MODEL=dolphin-mistral:latest ./bin/mh chat

# Enable verbose logging
DEBUG=metahuman:* pnpm dev
```

### Virtual Environment Activation
If using Python components:
```bash
source venv/bin/activate  # Linux/macOS
# or
venv\Scripts\activate.bat  # Windows
```

## Troubleshooting Startup Issues

### Common Problems and Solutions

1. **"Command not found" errors**
   ```bash
   # Check Node.js and pnpm
   node --version
   pnpm --version
   
   # Install if missing
   # Node.js: https://nodejs.org/
   # pnpm: npm install -g pnpm
   ```

2. **Permission denied**
   ```bash
   # Make scripts executable
   chmod +x start.sh
   chmod +x bin/mh
   ```

3. **Missing dependencies**
   ```bash
   # Install all dependencies
   pnpm install
   
   # Install specific package
   pnpm add <package-name>
   ```

4. **Ollama not running**
   ```bash
   # Start Ollama service
   ollama serve
   
   # Check status
   ./bin/mh ollama status
   ```

5. **Port conflicts**
   ```bash
   # Use different port
   PORT=3001 pnpm dev
   ```

## Custom Startup Scripts

Users can create their own startup scripts for specific workflows:

### Example: Custom Development Script
```bash
#!/bin/bash
# custom-dev-start.sh

# Start background agents
./bin/mh agent run organizer &
./bin/mh agent run boredom-service &

# Start web interface
cd apps/site
pnpm dev
```

### Example: Presentation Mode Script
```bash
#!/bin/bash
# presentation-mode.sh

# Start with specific configuration
export PRESENTATION_MODE=true
cd apps/site
pnpm dev --port 8080
```

## Performance Optimization

### Fast Startup Options
For quicker startup times:

```bash
# Skip dependency checks
cd apps/site && pnpm dev

# Use cached builds
cd apps/site && pnpm dev --cached

# Skip initial audits
SKIP_AUDIT=true pnpm dev
```

### Resource-Constrained Environments
For systems with limited resources:

```bash
# Use lighter models
./bin/mh ollama pull phi3:mini

# Limit concurrent processes
MAX_AGENTS=2 ./bin/mh agent run organizer
```

## Security Considerations

### Safe Startup Practices

1. **Local Development Only**
   ```bash
   # Ensure binding to localhost only
   HOST=localhost pnpm dev
   ```

2. **Environment Isolation**
   ```bash
   # Use .env files for configuration
   cp .env.example .env
   # Edit .env with your settings
   ```

3. **File Permissions**
   ```bash
   # Secure sensitive files
   chmod 600 .env
   chmod 700 persona/
   ```

## Automation and Scheduling

### System Startup Integration

#### Linux (systemd)
```ini
# /etc/systemd/system/metahuman.service
[Unit]
Description=MetaHuman OS
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/home/your-username/metahuman
ExecStart=/home/your-username/metahuman/start.sh
Restart=always

[Install]
WantedBy=multi-user.target
```

#### macOS (launchd)
Create a plist file in `~/Library/LaunchAgents/`

#### Windows (Task Scheduler)
Use Task Scheduler to run `start.bat` at login

## Monitoring and Maintenance

### Health Checks
```bash
# Check system status
./bin/mh status

# Monitor running agents
./bin/mh agent ps

# Check logs
./bin/mh agent logs <agent-name>

# View audit trail
tail -f logs/audit/latest.ndjson
```

### Regular Maintenance
```bash
# Update dependencies
pnpm update

# Clean cache
pnpm store prune

# Backup persona files
cp -r persona/ persona-backup-$(date +%F)/
```

## Conclusion

The MetaHuman OS startup system provides flexible options for users of all skill levels:
- **Beginners**: Use the platform-specific startup scripts (`start.sh`, `start.bat`, `start.py`)
- **Intermediate**: Manual startup with `pnpm dev`
- **Advanced**: Custom scripts and system integration

Choose the method that best fits your workflow and technical comfort level.