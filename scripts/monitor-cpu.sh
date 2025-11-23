#!/bin/bash
# CPU monitoring script for Astro dev server
# Usage: ./scripts/monitor-cpu.sh [process_name]

PROCESS_NAME="${1:-astro.js dev}"
LOG_FILE="/tmp/metahuman-cpu-monitor.log"
INTERVAL=2  # seconds

echo "🔍 Monitoring CPU usage for processes matching: $PROCESS_NAME"
echo "📊 Logging to: $LOG_FILE"
echo "⏱️  Sampling every ${INTERVAL}s (Ctrl+C to stop)"
echo ""

# Clear previous log
> "$LOG_FILE"

while true; do
  TIMESTAMP=$(date '+%H:%M:%S')

  # Get CPU% for matching processes
  PROCESSES=$(ps aux | grep "$PROCESS_NAME" | grep -v grep | grep -v monitor-cpu)

  if [ -z "$PROCESSES" ]; then
    echo "[$TIMESTAMP] ⚠️  No processes found matching '$PROCESS_NAME'"
    echo "[$TIMESTAMP] No process found" >> "$LOG_FILE"
  else
    echo "[$TIMESTAMP]"
    echo "$PROCESSES" | awk '{printf "  PID: %-8s CPU: %5s%%  MEM: %5s%%  CMD: %s\n", $2, $3, $4, substr($0, index($0,$11))}'

    # Log to file
    echo "[$TIMESTAMP]" >> "$LOG_FILE"
    echo "$PROCESSES" | awk '{printf "  PID: %-8s CPU: %5s%%\n", $2, $3}' >> "$LOG_FILE"

    # Alert if CPU > 80%
    echo "$PROCESSES" | awk -v ts="$TIMESTAMP" '$3 > 80 {printf "  🔥 HIGH CPU: %s%% (PID %s)\n", $3, $2}'
  fi

  sleep "$INTERVAL"
done
