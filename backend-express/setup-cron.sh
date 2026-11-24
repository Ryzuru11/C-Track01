#!/bin/bash

# Setup Cron Job for Backend Monitoring
# This script sets up an automatic monitor on the VPS to restart backend if it crashes
# Run this ONCE on the VPS to enable auto-recovery

CRON_SCHEDULE="*/5 * * * *"  # Every 5 minutes
BACKEND_DIR="/var/www/C-Track/backend-express"
SCRIPT_PATH="$BACKEND_DIR/restart-backend.sh"

# Check if script exists on VPS
if [ ! -f "$SCRIPT_PATH" ]; then
    echo "❌ Error: restart-backend.sh not found at $SCRIPT_PATH"
    echo "Please deploy the script first"
    exit 1
fi

# Add cron job (avoid duplicates)
if ! crontab -l 2>/dev/null | grep -q "restart-backend.sh"; then
    echo "Adding cron job..."
    (crontab -l 2>/dev/null; echo "$CRON_SCHEDULE $SCRIPT_PATH") | crontab -
    echo "✅ Cron job added: Check backend every 5 minutes"
    crontab -l
else
    echo "✅ Cron job already exists"
    crontab -l | grep restart-backend.sh
fi
