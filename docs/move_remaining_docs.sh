#!/bin/bash

# This script moves the remaining documentation files to the archived folder
# since their content has been consolidated into the comprehensive user guide

echo "Moving remaining documentation files to archive..."

# Create the archive directory if it doesn't exist (though it should already exist)
mkdir -p docs/archive

# List of remaining files to move to archive
files_to_move=(
    "docs/LORA_FINAL_STATUS.md"
    "docs/OPERATOR-QUICK-START.md"
    "docs/SKILLS.md"
    "docs/TRUST.md"
    "docs/USER_GUIDE.md"
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

echo "Archiving complete! Moved $moved_count documentation files to docs/archive/."
echo ""
echo "All essential documentation has been consolidated into CLEAN_USER_GUIDE.md"
echo "The repository documentation is now streamlined and professional."
echo ""
echo "Key documentation preserved:"
echo "  - README.md (main project overview)"
echo "  - ARCHITECTURE.md (technical architecture)"
echo "  - DESIGN.md (design document)"
echo "  - CLEAN_USER_GUIDE.md (comprehensive consolidated guide)"
echo "  - All memory and brain agent README files (in their respective directories)"
echo ""
echo "Historical/development documentation preserved in docs/archive/ for reference."