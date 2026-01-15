# MetaHuman Studio Backups

This directory contains backups of all MetaHuman Studio customizations for VS Code.

## Latest Backup

**File**: `metahuman-studio-customizations-20260114-143544.tar.gz`
**Size**: 85MB
**Created**: 2025-01-14 14:35:44

## What's Included

- ✅ Product branding (product.json)
- ✅ MetaHuman Studio icons (SVG, PNG, ICO, ICNS)
- ✅ Build scripts (build.sh, launch.sh, etc.)
- ✅ MetaHuman-core extension
- ✅ All documentation files
- ✅ VS Code configuration
- ✅ Automated restoration script

## How to Restore

### Quick Restore (to existing VS Code)
```bash
# 1. Extract the backup
tar -xzf metahuman-studio-customizations-20260114-143544.tar.gz

# 2. Navigate to your VS Code directory
cd /path/to/vscode

# 3. Run the restoration script
../path/to/backup/metahuman-studio-backup-20260114-143544/restore-customizations.sh
```

### Fresh Install
```bash
# 1. Clone VS Code
git clone https://github.com/microsoft/vscode.git
cd vscode

# 2. Extract and restore customizations
tar -xzf /path/to/metahuman-studio-customizations-20260114-143544.tar.gz
./metahuman-studio-backup-20260114-143544/restore-customizations.sh

# 3. Install dependencies and build
npm install
./build.sh

# 4. Run MetaHuman Studio
./launch.sh
```

## Creating New Backups

From the `apps/code-oss` directory:
```bash
./backup-metahuman-customizations.sh
```

This will create a new timestamped backup with all current customizations.

## Important Files

- `METAHUMAN-CUSTOMIZATIONS-BACKUP-PLAN.md` - Detailed backup plan and file list
- `backup-metahuman-customizations.sh` - Script to create new backups
- Each backup includes `restore-customizations.sh` for easy restoration