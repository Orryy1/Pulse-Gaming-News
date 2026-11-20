#!/bin/bash
# Installs the concept-sketch service (mac/sketch_server.py) as its own launchd service on the Mac mini,
# com.pulse.sketch, so documentaries and long videos get their ILLUSTRATION sketches (ILLUSTRATE_ENABLED,
# src/assets/illustrate.ts) from this machine's own GPU: ILLUSTRATE_URL=http://127.0.0.1:8798 in the factory's .env.
# The model is FLUX.2 klein 4B, Apache 2.0 (docs/licences/flux2-klein-4b.md); FLUX.1 dev and Fill are never used.
#
# What it does, idempotently:
#  1. a Python venv at ~/PulseFactory/sketch/venv (about 1 GB) with pinned torch, diffusers and transformers;
#  2. the weights (about 15 GB) at SKETCH_MODEL_DIR, by default on the external drive
#     /Volumes/Storage/pulse-sketch/FLUX.2-klein-4B, fetched from Hugging Face at a pinned revision and checked to
#     carry the Apache 2.0 licence. The internal disk is kept above 35 GB free: the install stops before going under;
#  3. the launchd service, listening on 127.0.0.1 only, then waits for its /health. A launchd service may not read
#     an external drive until macOS allows it (Privacy & Security > Full Disk Access for the venv's Python): found
#     20 Nov 2026, when the first install could see the weights but not open them. /health then says so (503), the
#     factory skips sketches for that video, and this script prints the one setting to change.
# Run on the Mac:  bash ~/PulseFactory/factory/mac/sketch.sh            (install or update)
#                  bash ~/PulseFactory/factory/mac/sketch.sh uninstall  (service off; venv and weights kept)
set -e
export PATH="/opt/homebrew/bin:$PATH"
LABEL=com.pulse.sketch
AGENTS="$HOME/Library/LaunchAgents"
LOGS="$HOME/PulseFactory/logs"
HOME_DIR="$HOME/PulseFactory/sketch"
VENV="$HOME_DIR/venv"
HERE="$(cd "$(dirname "$0")" && pwd)"
SERVER="$HERE/sketch_server.py"
PORT="${SKETCH_PORT:-8798}"
MODEL_DIR="${SKETCH_MODEL_DIR:-/Volumes/Storage/pulse-sketch/FLUX.2-klein-4B}"
REPO=black-forest-labs/FLUX.2-klein-4B
REVISION=e7b7dc27f91deacad38e78976d1f2b499d76a294 # 24 Feb 2026; licence apache-2.0, checked 20 Nov 2026
FLOOR_GB=35

if [ "$1" = "uninstall" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$AGENTS/$LABEL.plist"
  echo "removed $LABEL (venv at $VENV and weights at $MODEL_DIR kept)"
  exit 0
fi

free_gb() { df -g "$1" | awk 'NR==2 {print $4}'; }
same_disk() { [ "$(df "$1" | awk 'NR==2 {print $1}')" = "$(df "$HOME" | awk 'NR==2 {print $1}')" ]; }

test -f "$SERVER" || { echo "sketch_server.py is not beside this script ($SERVER)"; exit 1; }
mkdir -p "$AGENTS" "$LOGS" "$HOME_DIR"

# 1. The venv.
if [ ! -x "$VENV/bin/python" ]; then
  [ "$(free_gb "$HOME")" -ge $((FLOOR_GB + 2)) ] || { echo "internal disk has $(free_gb "$HOME") GB free; the venv needs about 1 GB above the ${FLOOR_GB} GB floor"; exit 1; }
  python3.12 -m venv "$VENV"
fi
# No download caches on the internal disk: pip's is off, and Hugging Face's goes beside the weights (below).
export PIP_NO_CACHE_DIR=1 HF_XET_CHUNK_CACHE_SIZE_BYTES=0
"$VENV/bin/pip" install -q --upgrade pip
# The versions measured on 20 Nov 2026; the server uses diffusers' klein internals, so nothing floats.
"$VENV/bin/pip" install -q "torch==2.15.0" "diffusers==0.43.0" "transformers==5.23.0" "accelerate==1.16.0" \
  "safetensors==0.8.0" "huggingface_hub==2.4.0" "hf-xet==1.8.0" "tokenizers==0.23.3" "pillow==13.0.0" "numpy==2.5.5"
"$VENV/bin/python" -c "from diffusers import Flux2KleinPipeline; import torch; assert torch.backends.mps.is_available(), 'no MPS'"

# 2. The weights. The download always runs: it is quick when everything is there, and finishes a broken one.
parent="$(dirname "$MODEL_DIR")"
mkdir -p "$parent" || { echo "cannot create $parent (is the external drive mounted?)"; exit 1; }
if [ ! -f "$MODEL_DIR/transformer/diffusion_pytorch_model.safetensors" ]; then
  need=16
  if same_disk "$parent"; then need=$((FLOOR_GB + 16)); fi
  [ "$(free_gb "$parent")" -ge "$need" ] || { echo "$parent has $(free_gb "$parent") GB free; the weights need 16 GB (and the internal disk keeps ${FLOOR_GB} GB)"; exit 1; }
fi
HF_HOME="$parent/.hf-home" "$VENV/bin/hf" download "$REPO" --revision "$REVISION" --local-dir "$MODEL_DIR" \
  --exclude "flux-2-klein-4b.safetensors" --exclude "*.jpg"
grep -q "Apache License" "$MODEL_DIR/LICENSE.md" || { echo "the weights at $MODEL_DIR do not carry the Apache 2.0 licence; stopping"; exit 1; }
grep -q '"Flux2KleinPipeline"' "$MODEL_DIR/model_index.json" || { echo "$MODEL_DIR is not FLUX.2 klein; stopping"; exit 1; }
[ "$(free_gb "$HOME")" -ge "$FLOOR_GB" ] || { echo "the internal disk is under ${FLOOR_GB} GB free ($(free_gb "$HOME") GB); stopping before the service goes on"; exit 1; }

# 3. The service.
cat > "$AGENTS/$LABEL.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>$LABEL</string>
<key>ProgramArguments</key><array>
<string>$VENV/bin/python</string><string>$SERVER</string>
</array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>30</integer>
<key>ProcessType</key><string>Background</string>
<key>EnvironmentVariables</key><dict>
<key>PATH</key><string>/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
<key>SKETCH_PORT</key><string>$PORT</string>
<key>SKETCH_MODEL_DIR</key><string>$MODEL_DIR</string>
<key>HF_HUB_OFFLINE</key><string>1</string>
<key>PYTORCH_ENABLE_MPS_FALLBACK</key><string>1</string>
</dict>
<key>StandardOutPath</key><string>$LOGS/$LABEL.log</string>
<key>StandardErrorPath</key><string>$LOGS/$LABEL.log</string>
</dict></plist>
EOF
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
sleep 1
launchctl bootstrap "gui/$(id -u)" "$AGENTS/$LABEL.plist" && echo "loaded $LABEL"
for _ in $(seq 1 30); do
  if curl -sf --max-time 10 "http://127.0.0.1:$PORT/health" >/dev/null; then
    echo "sketch service answering on 127.0.0.1:$PORT"
    exit 0
  fi
  sleep 2
done
echo "the sketch service is not ready on 127.0.0.1:$PORT: $(curl -s --max-time 10 "http://127.0.0.1:$PORT/health")"
case "$MODEL_DIR" in
  /Volumes/*) echo "macOS lets a background service read an external drive only once allowed: System Settings >"
              app="$(cd "$(dirname "$(readlink -f "$VENV/bin/python")")/../Resources" 2>/dev/null && pwd)/Python.app" ||
                app="the venv's Python ($(readlink -f "$VENV/bin/python"))"
              echo "Privacy & Security > Full Disk Access, press +, add $app and switch it on, then run this again"
              echo "(a Homebrew Python upgrade moves that path: allow the new one then)" ;;
esac
echo "log: $LOGS/$LABEL.log"
exit 1
