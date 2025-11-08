#!/bin/bash

echo "🛑 Stopping Institutional Rotation Detector Development Environment"

# Stop Supabase
echo "Stopping Supabase..."
supabase stop

# Kill Temporal if running
echo "Stopping Temporal..."
pkill -f "temporal server" || true

echo "✅ All services stopped"
