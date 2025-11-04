#!/usr/bin/env bash
set -euo pipefail

# MetaHuman Autonomy Bootstrap
# - Installs: Node 18+, pnpm, Ollama (+ base model), whisper.cpp (+ model),
#             Conda env + accelerate/Axolotl (best effort), and repo configs
# - Configures: etc/sleep.json (LoRA on), etc/auto-approval.json (live + auto*)
# - Verifies tools and prints clear next steps
#
# Run from the repo root: ./scripts/bootstrap_autonomy.sh

REPO_ROOT="$(pwd)"
BASE_MODEL="${METAHUMAN_BASE_MODEL:-dolphin-mistral:latest}"
WHISPER_MODEL="${WHISPER_MODEL_NAME:-ggml-base.en.bin}"
WHISPER_MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/models/${WHISPER_MODEL}"
MODELS_DIR="${REPO_ROOT}/models"
ETC_DIR="${REPO_ROOT}/etc"
AUDIO_CFG="${ETC_DIR}/audio.json"
SLEEP_CFG="${ETC_DIR}/sleep.json"
AUTO_APPROVAL_CFG="${ETC_DIR}/auto-approval.json"
UNAME="$(uname -s)"
OS="${OS:-unknown}"
if [[ -f /etc/os-release ]]; then . /etc/os-release; OS="${ID:-$OS}"; fi

log()  { printf "\033[1;34m[+] %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m[!] %s\033[0m\n" "$*"; }
err()  { printf "\033[1;31m[✗] %s\033[0m\n" "$*"; }

need_cmd() { command -v "$1" >/dev/null 2>&1 || return 1; }

ensure_node() {
  if need_cmd node; then
    ver="$(node -v | sed 's/v//')"
    major="${ver%%.*}"
    if [[ "${major}" -ge 18 ]]; then log "Node ${ver} OK"; return; fi
    warn "Node < 18 detected (${ver}); installing LTS via nvm"
  else
    warn "Node not found; installing via nvm"
  fi
  if ! need_cmd curl; then err "curl required to install nvm/node"; exit 1; fi
  export NVM_DIR="$HOME/.nvm"
  if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  fi
  # shellcheck disable=SC1090
  . "$NVM_DIR/nvm.sh"
  nvm install --lts
  nvm alias default 'lts/*'
  log "Node $(node -v) installed"
}

ensure_pnpm() {
  if need_cmd pnpm; then log "pnpm $(pnpm -v) OK"; return; fi
  if need_cmd corepack; then corepack enable; corepack prepare pnpm@latest --activate; log "pnpm installed via corepack"; else npm install -g pnpm; fi
}

ensure_ollama() {
  if need_cmd ollama; then log "Ollama present"; else
    case "${UNAME}" in
      Darwin) if need_cmd brew; then brew install ollama; else err "Install Homebrew or Ollama manually"; exit 1; fi ;;
      Linux)  if need_cmd curl; then curl -fsSL https://ollama.com/install.sh | sh; else err "curl required for Ollama install"; exit 1; fi ;;
      *) err "Unsupported OS for auto-install (Ollama)"; exit 1 ;;
    esac
  fi
  if ! curl -fsS http://localhost:11434/api/version >/dev/null 2>&1; then nohup ollama serve >/dev/null 2>&1 & sleep 2; fi
  log "Ensuring base model: ${BASE_MODEL}"
  ollama list | grep -q "^${BASE_MODEL%:*}" || ollama pull "${BASE_MODEL}" || warn "Could not pull base model"
}

ensure_whisper_cpp() {
  if command -v whisper >/dev/null 2>&1; then log "whisper.cpp binary found: $(command -v whisper)"; else
    case "${UNAME}" in
      Darwin) if need_cmd brew; then brew install whisper-cpp; else warn "brew missing; skip whisper.cpp"; fi ;;
      Linux)
        if need_cmd cmake && need_cmd make && need_cmd git; then
          tmp="${HOME}/.cache/whisper.cpp"; mkdir -p "${tmp}"
          [[ -d "${tmp}/repo" ]] || git clone --depth=1 https://github.com/ggerganov/whisper.cpp "${tmp}/repo"
          (cd "${tmp}/repo" && make -j) || warn "whisper.cpp build failed"
          [[ -x "${tmp}/repo/main" ]] && ln -sf "${tmp}/repo/main" "${HOME}/.local/bin/whisper"
        else warn "Missing cmake/make/git; skip whisper.cpp"; fi ;;
      *) warn "Unsupported OS for whisper.cpp" ;;
    esac
  fi
  mkdir -p "${MODELS_DIR}"
  if [[ ! -f "${MODELS_DIR}/${WHISPER_MODEL}" ]] && need_cmd curl; then
    log "Downloading ${WHISPER_MODEL}"
    curl -fsSL "${WHISPER_MODEL_URL}" -o "${MODELS_DIR}/${WHISPER_MODEL}" || warn "Failed to download whisper model"
  fi
}

ensure_audio_config() {
  mkdir -p "${ETC_DIR}"
  if [[ ! -f "${AUDIO_CFG}" ]]; then
    cat > "${AUDIO_CFG}" <<EOF
{
  "transcription": {
    "provider": "whisper.cpp",
    "model": "base.en",
    "language": "en",
    "temperature": 0.0,
    "autoTranscribe": true,
    "whisperCppPath": "whisper",
    "modelPath": "${MODELS_DIR}/${WHISPER_MODEL}"
  },
  "formats": { "supported": ["mp3","wav","m4a","ogg","webm","flac"], "maxSizeMB": 100 },
  "processing": { "autoOrganize": true, "extractEntities": true, "generateSummary": true, "minDurationSeconds": 5 },
  "retention": { "keepOriginal": true, "archiveAfterDays": 90, "deleteTranscriptsAfterDays": 365 }
}
EOF
  else
    if need_cmd jq; then
      tmp="$(mktemp)" && jq ".transcription.whisperCppPath=\"whisper\" | .transcription.modelPath=\"${MODELS_DIR}/${WHISPER_MODEL}\"" "${AUDIO_CFG}" >"${tmp}" && mv "${tmp}" "${AUDIO_CFG}" || true
    fi
  fi
}

ensure_sleep_and_autoapproval() {
  if [[ -f "${SLEEP_CFG}" ]] && need_cmd jq; then
    tmp="$(mktemp)" && jq '.adapters.lora=true | .enabled=true' "${SLEEP_CFG}" > "${tmp}" && mv "${tmp}" "${SLEEP_CFG}" || true
  else
    cat > "${SLEEP_CFG}" <<EOF
{
  "enabled": true,
  "window": { "start": "23:00", "end": "06:30" },
  "minIdleMins": 15,
  "maxDreamsPerNight": 3,
  "showInUI": true,
  "evaluate": true,
  "adapters": { "prompt": true, "rag": true, "lora": true }
}
EOF
  fi
  if [[ -f "${AUTO_APPROVAL_CFG}" ]] && need_cmd jq; then
    tmp="$(mktemp)" && jq '.enabled=true | .dryRun=false | .autoTrain=true | .autoEval=true | .autoActivate=true' "${AUTO_APPROVAL_CFG}" > "${tmp}" && mv "${tmp}" "${AUTO_APPROVAL_CFG}" || true
  else
    cat > "${AUTO_APPROVAL_CFG}" <<EOF
{
  "enabled": true,
  "dryRun": false,
  "thresholds": { "minPairs": 30, "minHighConfidence": 0.6, "minReflectionPct": 0.2, "maxLowConfidence": 0.2 },
  "autoTrain": true,
  "autoEval": true,
  "autoActivate": true
}
EOF
  fi
}

ensure_conda_axolotl() {
  if ! need_cmd conda; then
    warn "Conda not found; installing Miniconda"
    if [[ "${UNAME}" == "Darwin" ]]; then curl -fsSL https://repo.anaconda.com/miniconda/Miniconda3-latest-MacOSX-$(uname -m).sh -o /tmp/miniconda.sh; else curl -fsSL https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-$(uname -m).sh -o /tmp/miniconda.sh; fi
    bash /tmp/miniconda.sh -b -p "$HOME/miniconda3" || warn "Miniconda install failed"
    export PATH="$HOME/miniconda3/bin:$PATH"
  fi
  if need_cmd conda; then
    log "Ensuring 'lora' conda env with accelerate/Axolotl"
    conda config --set always_yes yes --set changeps1 no >/dev/null 2>&1 || true
    conda create -n lora python=3.10 >/dev/null 2>&1 || true
    # shellcheck disable=SC1090
    source "$(conda info --base)/etc/profile.d/conda.sh" || true
    conda activate lora || true
    pip install --upgrade pip >/dev/null 2>&1 || true
    pip install accelerate axolotl >/dev/null 2>&1 || warn "Axolotl/accelerate install failed (manual GPU setup may be required)"
  else
    warn "Conda not available; trainer will run in manual mode"
  fi
}

verify() {
  echo; log "Verification summary:"
  if need_cmd node; then echo " - Node: $(node -v)"; else echo " - Node: MISSING"; fi
  if need_cmd pnpm; then echo " - pnpm: $(pnpm -v)"; else echo " - pnpm: MISSING"; fi
  if need_cmd ollama; then echo " - Ollama: present"; curl -fsS http://localhost:11434/api/version 2>/dev/null | jq -r '.version' || true; echo " - Ollama models:"; ollama list || true; else echo " - Ollama: MISSING"; fi
  if need_cmd whisper; then echo " - whisper.cpp: OK"; else echo " - whisper.cpp: MISSING"; fi
  [[ -f "${MODELS_DIR}/${WHISPER_MODEL}" ]] && echo " - Whisper model: ${WHISPER_MODEL} (OK)" || echo " - Whisper model: MISSING"
  [[ -f "${AUDIO_CFG}" ]] && echo " - etc/audio.json: OK" || echo " - etc/audio.json: MISSING"
  [[ -f "${SLEEP_CFG}" ]] && echo " - etc/sleep.json: OK (LoRA enabled)" || echo " - etc/sleep.json: MISSING"
  [[ -f "${AUTO_APPROVAL_CFG}" ]] && echo " - etc/auto-approval.json: OK (live)" || echo " - etc/auto-approval.json: MISSING"
  echo
}

main() {
  log "Repo root: ${REPO_ROOT}"
  ensure_node
  ensure_pnpm
  ensure_ollama
  ensure_whisper_cpp
  ensure_audio_config
  ensure_sleep_and_autoapproval
  ensure_conda_axolotl
  verify

  echo
  log "Bootstrap complete."
  echo "Next:"
  echo "  1) Start Sleep Service once (keeps running): ./bin/mh agent run sleep-service"
  echo "     - Optional auto-load: export METAHUMAN_AUTO_OLLAMA_CREATE=1"
  echo "  2) Or kick it now from the UI: Adaptation → Run Full Cycle Now"
  echo "  3) Watch audit stream; Active Adapter flips to loaded when model is created"
  echo
}

main "$@"

