#!/bin/bash
# Create missing directories for blueaprilk profile

mkdir -p /home/greggles/metahuman/profiles/blueaprilk/persona/desires/{nascent,pending,active,completed,rejected,abandoned,plans,reviews,metrics,awaiting_approval,folders}
mkdir -p /home/greggles/metahuman/profiles/blueaprilk/state/agency

# Add .keep files
for d in /home/greggles/metahuman/profiles/blueaprilk/persona/desires/*/; do
  touch "$d/.keep"
done
touch /home/greggles/metahuman/profiles/blueaprilk/state/agency/.keep

echo "Done! Created directories for blueaprilk profile"
