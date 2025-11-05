# Security Guidelines for MetaHuman OS

This document outlines security best practices for the MetaHuman OS repository.

## 1. Secrets Management

### What's Protected

The `.gitignore` file is configured to exclude:

**Environment Files:**
- `.env`, `.env.local`, `.env.*.local`
- `*.key`, `*.pem`, `*.cert`, `*.crt`

**AI Models & Large Files:**
- `*.gguf`, `*.ggml`, `*.safetensors`, `*.bin`
- `.ollama/` directory

**Personal Data:**
- All `/persona/` configuration files (except templates)
- All `/memory/` content (episodic, semantic, tasks)
- All `/logs/` and `/out/` directories
- All `/etc/` runtime configuration (except templates and training configs)

**Credentials & Secrets:**
- `.ssh/`, `.aws/`, `.gcp/`, `.azure/`
- `credentials/`, `secrets/` directories
- `venv/` Python virtual environments

### If You Accidentally Commit a Secret

1. **Remove it from git history:**
   ```bash
   # For a specific file
   git filter-branch --force --index-filter \
     "git rm --cached --ignore-unmatch path/to/secret/file" \
     --prune-empty --tag-name-filter cat -- --all

   # Or use BFG Repo-Cleaner (faster)
   bfg --delete-files secret-file.env
   git reflog expire --expire=now --all
   git gc --prune=now --aggressive
   ```

2. **Force push the cleaned history:**
   ```bash
   git push origin --force --all
   git push origin --force --tags
   ```

3. **Rotate the compromised credentials immediately:**
   - RunPod API keys: Regenerate in RunPod dashboard
   - Brave Search API keys: Regenerate in Brave dashboard
   - Any other API keys/tokens: Rotate at the provider

4. **Enable GitHub secret scanning:**
   - Go to: Repository → Settings → Security → Code security and analysis
   - Enable "Secret scanning" and "Push protection"

## 2. Branch Protection Rules

Protect the `main` branch from accidental damage:

### Setup Instructions

1. Go to your GitHub repository
2. Navigate to: Settings → Branches
3. Click "Add rule" or "Add branch protection rule"
4. Configure the following settings:

**Branch name pattern:**
```
main
```

**Required settings:**
- ✅ **Require a pull request before merging**
  - Require approvals: 0 (you can approve your own PRs)
  - Dismiss stale pull request approvals when new commits are pushed

- ✅ **Require status checks to pass before merging** (optional for now)
  - Add checks as you implement CI/CD (tests, linting, builds)

- ✅ **Require conversation resolution before merging** (optional but recommended)

- ✅ **Do not allow bypassing the above settings**

- ✅ **Restrict who can push to matching branches**
  - Add yourself or leave empty to restrict everyone

- ✅ **Require linear history** (optional but recommended)
  - Enforces clean, rebased commits (no merge commits)

- ✅ **Block force pushes**
  - Prevents destructive `git push --force` operations

- ✅ **Do not allow deletions**
  - Prevents accidental branch deletion

### Benefits

- **Pull Request Workflow**: Even solo, you review changes before merging
- **No Accidental Force Pushes**: Can't accidentally rewrite history
- **Clean History**: Linear history makes debugging easier
- **Rollback Safety**: Always can revert to last good state

### Workflow with Branch Protection

```bash
# Create feature branch
git checkout -b feature/my-feature

# Make changes and commit
git add .
git commit -m "Add feature"

# Push to GitHub
git push origin feature/my-feature

# Create Pull Request on GitHub
# Review changes, then merge PR

# GitHub will merge to main (not you directly)
```

## 3. Backup & Recovery Strategy

### GitHub as Primary Remote

GitHub provides:
- ✅ High availability (99.9% uptime)
- ✅ Automatic backups
- ✅ Disaster recovery
- ✅ Access control

### Additional Backup Options

**Option A: Secondary Git Remote (Recommended)**

Add a secondary remote (GitLab, Gitea, self-hosted):

```bash
# Add secondary remote
git remote add backup git@gitlab.com:yourusername/metahuman.git

# Push to both remotes
git push origin main
git push backup main

# Or push to all remotes at once
git remote add all git@github.com:yourusername/metahuman.git
git remote set-url --add --push all git@github.com:yourusername/metahuman.git
git remote set-url --add --push all git@gitlab.com:yourusername/metahuman.git
git push all main
```

**Option B: Local Backup Script**

Create a daily backup script:

```bash
#!/bin/bash
# backup-metahuman.sh

BACKUP_DIR="$HOME/backups/metahuman"
DATE=$(date +%Y-%m-%d)
ARCHIVE="$BACKUP_DIR/metahuman-$DATE.tar.gz"

mkdir -p "$BACKUP_DIR"

# Clone fresh copy
git clone --mirror git@github.com:yourusername/metahuman.git /tmp/metahuman-mirror

# Archive it
tar -czf "$ARCHIVE" -C /tmp metahuman-mirror

# Cleanup
rm -rf /tmp/metahuman-mirror

# Keep only last 30 days
find "$BACKUP_DIR" -name "metahuman-*.tar.gz" -mtime +30 -delete

echo "Backup completed: $ARCHIVE"
```

**Option C: Cloud Sync (Personal Data Only)**

Since your repo excludes personal data (persona, memory, logs), you may want separate backups for those:

```bash
# Sync personal data to cloud storage (encrypted)
tar -czf metahuman-personal-$(date +%Y-%m-%d).tar.gz \
  persona/ memory/ logs/ etc/ out/

# Encrypt it
gpg --symmetric --cipher-algo AES256 metahuman-personal-*.tar.gz

# Upload to cloud (your choice of provider)
rclone copy metahuman-personal-*.tar.gz.gpg remote:backups/
```

### Recovery Testing

Test your backups periodically:

```bash
# Test git recovery
cd /tmp
git clone git@github.com:yourusername/metahuman.git metahuman-test
cd metahuman-test
pnpm install
./bin/mh status

# Verify backup archive
tar -tzf ~/backups/metahuman/metahuman-2025-11-05.tar.gz | head
```

## 4. Security Checklist

Before pushing code:

- [ ] No `.env` files (only `.env.example` with placeholders)
- [ ] No API keys, tokens, or passwords in code
- [ ] No personal data (persona, memory, logs committed)
- [ ] No `.gguf` or large model files
- [ ] Branch protection enabled on `main`
- [ ] Secret scanning enabled in GitHub
- [ ] Backup strategy in place and tested

## 5. Public vs Private Repository

**Current Status**: Appears to be public (or intended to be)

**Considerations:**

**Keep Public If:**
- ✅ You want to showcase your work
- ✅ Open source contributions are welcome
- ✅ No sensitive data is committed (handled via .gitignore)
- ✅ You're comfortable with code visibility

**Make Private If:**
- ⚠️ You're concerned about code/architecture visibility
- ⚠️ You want control over who sees your work
- ⚠️ You're working on proprietary features

**Hybrid Approach:**
- Keep main repo public (just code)
- Use private repo for personal data backups
- Use private fork for experimental features

## 6. Incident Response

If a security issue occurs:

1. **Immediate Actions:**
   - Rotate compromised credentials
   - Remove sensitive data from history (see Section 1)
   - Enable GitHub push protection
   - Review recent commits for other issues

2. **Investigation:**
   - Check GitHub's "Security" tab for alerts
   - Review `git log --all --full-history` for sensitive files
   - Audit all open PRs and issues

3. **Prevention:**
   - Update `.gitignore`
   - Add pre-commit hooks (see Section 7)
   - Document the incident and lessons learned

## 7. Pre-Commit Hooks (Optional)

Prevent accidental commits of secrets:

```bash
# Install pre-commit framework
pip install pre-commit

# Create .pre-commit-config.yaml
cat > .pre-commit-config.yaml << 'EOF'
repos:
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v4.5.0
    hooks:
      - id: check-added-large-files
        args: ['--maxkb=1000']
      - id: detect-private-key
      - id: check-merge-conflict

  - repo: https://github.com/Yelp/detect-secrets
    rev: v1.4.0
    hooks:
      - id: detect-secrets
        args: ['--baseline', '.secrets.baseline']
EOF

# Install hooks
pre-commit install

# Test it
pre-commit run --all-files
```

## 8. Additional Resources

- [GitHub Secret Scanning](https://docs.github.com/en/code-security/secret-scanning)
- [GitHub Branch Protection](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches)
- [BFG Repo-Cleaner](https://rtyley.github.io/bfg-repo-cleaner/)
- [Pre-commit Hooks](https://pre-commit.com/)
- [OWASP Secure Coding Practices](https://owasp.org/www-project-secure-coding-practices-quick-reference-guide/)
