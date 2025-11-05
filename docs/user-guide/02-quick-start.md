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
3. **Customize your persona:** Edit `persona/core.json` to match your personality, values, and goals
4. **Start the web UI:**
   ```bash
   cd apps/site && pnpm dev
   # Then open http://localhost:4321
   ```

   You will be greeted by a splash screen that provides real-time feedback as the OS initializes, loads your persona, and connects to the local models. This improves the startup experience by showing immediate activity.

---

