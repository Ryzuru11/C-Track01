#!/bin/bash

# Backend Auto-Recovery Script
# Checks if PM2 backend is running and restarts if necessary
# Usage: ./restart-backend.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="$SCRIPT_DIR/backend-recovery.log"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

echo "[$TIMESTAMP] Checking backend status..." >> "$LOG_FILE"

# Check if backend is running
if pm2 status | grep -q "backend.*online"; then
    echo "[$TIMESTAMP] ✅ Backend is running - no action needed" >> "$LOG_FILE"
    exit 0
fi

# Backend is not running - attempt restart
echo "[$TIMESTAMP] ⚠️  Backend is DOWN - attempting restart..." >> "$LOG_FILE"

cd "$SCRIPT_DIR"

# Try to restart with ecosystem config
if pm2 start ecosystem.config.js --update-env 2>&1 | tee -a "$LOG_FILE"; then
    sleep 3
    if pm2 status | grep -q "backend.*online"; then
        echo "[$TIMESTAMP] ✅ Backend successfully restarted!" >> "$LOG_FILE"
        echo "Backend restarted at $TIMESTAMP" | mail -s "C-Track Backend Recovered" cleon@202.169.232.241 2>/dev/null || true
        exit 0
    else
        echo "[$TIMESTAMP] ❌ Backend restart failed - still not online" >> "$LOG_FILE"
        exit 1
    fi
else
    echo "[$TIMESTAMP] ❌ Failed to start backend process" >> "$LOG_FILE"
    exit 1
fi
