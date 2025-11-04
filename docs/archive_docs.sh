#!/bin/bash

# This script moves obsolete documentation files to an archived folder
# to keep the repository clean while preserving the historical information

echo "Creating archive directory and moving obsolete documentation files..."

# Create the archive directory if it doesn't exist
mkdir -p docs/archive

# List of files to move to archive
files_to_move=(
    "docs/README (copy).md"
    "docs/ADAPTER_DUAL_LOADING.md"
    "docs/AI_DATASET_BUILDER_NOTES.md"
    "docs/audio-ingestion-plan.md"
    "docs/AUTONOMOUS_DUAL_ADAPTER_WORKFLOW.md"
    "docs/axlotl removal.md"
    "docs/CROSS_PLATFORM_ROADMAP.md"
    "docs/DEPLOYMENT_PLAN.md"
    "docs/dockr-rebuild-instructions"
    "docs/DREAMING.md"
    "docs/DUAL_ADAPTER_STATUS.md"
    "docs/DUAL-ADAPTER-ANALYSIS.md"
    "docs/file_operations_api.md"
    "docs/full-cycle-remote-train-2.md"
    "docs/full-cycle-remote-train.md"
    "docs/Implementation Plan Addendum.md"
    "docs/IMPLEMENTATION_PLAN.md"
    "docs/INTEGRATION-COMPLETE.md"
    "docs/INTEGRATION.md"
    "docs/INTERNET_SEARCH_INTEGRATION_ROADMAP.md"
    "docs/LOCAL-TRAINING-SETUP.md"
    "docs/LOGGING_IMPLEMENTATION_GUIDE.md"
    "docs/LOGGING_IMPROVEMENTS.md"
    "docs/lora training notes in runpod.md"
    "docs/LORA_AUTOMATION_ROADMAP.md"
    "docs/LORA_BUGFIXES.md"
    "docs/LORA_GGUF_INTEGRATION.md"
    "docs/LORA_IMPLEMENTATION_ROADMAP.md"
    "docs/LORA_IMPLEMENTATION_SUMMARY.md"
    "docs/LORA_QUICKSTART.md"
    "docs/lora-trainer-instructions.md"
    "docs/MEMORY_TAB_ENHANCEMENTS.md"
    "docs/MEMORY-PROCESSING-SETUP.md"
    "docs/MORNING_GAMEPLAN.md"
    "docs/multi-stage-reasoning-plan.md"
    "docs/NEXT_STEPS.md"
    "docs/operator-skill-tests.md"
    "docs/PHASE-0-COMPLETE.md"
    "docs/preplan-prompt.md"
    "docs/PROGRESS.md"
    "docs/REFLECTION_SYSTEM.md"
    "docs/REFACTOR_PLAN.md"
    "docs/ROADMAP.md"
    "docs/runpod_training_process.md"
    "docs/RUNPOD_TRAINING_PROGRESS.md"
    "docs/RUNPOD_TRAINING_SETUP.md"
    "docs/runpod-autonomy-status-2025-10-25.md"
    "docs/runpod-remote-instruction.md"
    "docs/SANITY_CHECK_BEFORE_RUN.md"
    "docs/SESSION_2025-10-21_DUAL_ADAPTER_AND_REFLECTION.md"
    "docs/SESSION_SUMMARY_2025-10-25.md"
    "docs/SESSION_SUMMARY_2025-10-28.md"
    "docs/SESSION-LOG-2025-10-19.md"
    "docs/SETUP_LOCAL_AI_AGENT.md"
    "docs/SLEEP_SERVICE.md"
    "docs/TIME-WEIGHTED-MEMORY.md"
    "docs/train-lora.md"
    "docs/TRAINING-DATA-ANALYSIS.md"
    "docs/TRAINING.md"
    "docs/VOICE_CLONING_PASSIVE.md"
    "docs/VOICE_CONTINUOUS_MODE.md"
    "docs/VOICE_CONVERSATIONS_COMPLETE.md"
    "docs/VOICE_CONVERSATIONS_ROADMAP.md"
    "docs/VOICE_FEATURES_SUMMARY.md"
    "docs/VOICE_INTEGRATION_PROGRESS.md"
    "docs/WEB_UI_IMPROVEMENTS.md"
    "docs/WEB_UI_MOBILE_RESPONSIVE_IMPLEMENTATION.md"
    "docs/web-search-skill.md"
    "docs/WEB-UI-COMPLETE.md"
    "docs/WHISPER_SETUP.md"
    "docs/QWEN3_30B_DOWNLOAD_STATUS.md"
)

# Move each file if it exists
moved_count=0
for file in "${files_to_move[@]}"; do
    if [ -f "$file" ]; then
        mv "$file" "docs/archive/"
        echo "Moved: $file -> docs/archive/"
        ((moved_count++))
    else
        echo "Skipped (not found): $file"
    fi
done

# Move the redundant README in docs/ to archive as well
if [ -f "docs/README.md" ]; then
    mv "docs/README.md" "docs/archive/"
    echo "Moved: docs/README.md -> docs/archive/"
    ((moved_count++))
fi

echo "Archiving complete! Moved $moved_count obsolete documentation files to docs/archive/."
echo ""
echo "The documentation has been streamlined to focus on essential user information."
echo "Archived files are preserved in docs/archive/ for historical reference."
echo ""
echo "Key files preserved in main documentation:"
echo "  - README.md (main project overview)"
echo "  - ARCHITECTURE.md (technical architecture)"
echo "  - DESIGN.md (design document)"
echo "  - CLEAN_USER_GUIDE.md (comprehensive user guide)"
echo "  - All memory and brain agent README files (in their respective directories)"
echo ""
echo "The repository is now much cleaner for professional presentation while preserving historical context."