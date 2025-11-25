## Quick Start

### Prerequisites
- Node.js 18+
- pnpm 9+
- TypeScript 5+
- Ollama (for local LLM) - Install from [ollama.ai](https://ollama.ai)
  - Recommended models: `phi3:mini` (default), `dolphin-mistral:latest`, `nomic-embed-text` (embeddings)

### Installation
```bash
# Clone the repository
git clone <your-repo-url>
cd metahuman

# Add bin/ to your PATH (optional)
export PATH="$PATH:$(pwd)/bin"

# Install workspace deps
pnpm install

# Initialize MetaHuman OS
./bin/mh init

# Check system status
./bin/mh status
```

### Initial Setup
1. **Install Ollama** (if not already installed) from [ollama.ai](https://ollama.ai)
2. **Install recommended model:**
   ```bash
   ./bin/mh ollama pull phi3:mini
   ```
3. **Start the web UI and register the owner profile:**
   ```bash
   cd apps/site && pnpm dev
   # Then open http://localhost:4321
   ```
   - On first launch you will be redirected to the **Authentication Gate**.
   - Click **Create Account** and register the first user. The first user is automatically granted the `owner` role.
   - Subsequent users can log in directly, or choose **Continue as Guest** to browse public personas in read-only mode.
4. **(Optional) Migrate existing single-user data:** run `pnpm tsx scripts/migrate-to-profiles.ts --username <owner>` if you are upgrading from a legacy installation with data at the repository root.
5. **Customize your persona (owner profile):** Edit `profiles/<owner>/persona/core.json` to match your personality, values, and goals.

---
