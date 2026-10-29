#!/bin/bash
# Pulse Factory: Mac mini setup. Paste into Terminal:
#   curl -fsSL https://pulse.orryy.com/mac-setup.sh | bash
# It installs the tools, keeps the Mac awake and restarting after power cuts, names it pulse-mac,
# lets the Pulse PC in with its own key (no passwords shared), then tells the factory it is ready.
set -e
echo ""
echo "== Pulse Factory Mac setup =="
echo "Type your Mac password once when asked (nothing shows while you type), then leave it to run."
sudo -v
while true; do sudo -n true; sleep 50; kill -0 "$$" 2>/dev/null || exit; done 2>/dev/null &

if ! command -v brew >/dev/null 2>&1 && [ ! -x /opt/homebrew/bin/brew ]; then
  echo "Installing Homebrew..."
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi
eval "$(/opt/homebrew/bin/brew shellenv)"
grep -q 'brew shellenv' ~/.zprofile 2>/dev/null || echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile

echo "Installing the factory's tools (this takes a few minutes)..."
brew install node git ffmpeg yt-dlp cloudflared python@3.12 || true
brew install --cask brave-browser claude || true

echo "Keeping the Mac awake and restarting after power cuts..."
sudo pmset -a sleep 0 disksleep 0 displaysleep 30 autorestart 1 womp 1
sudo scutil --set ComputerName "Pulse Mac"
sudo scutil --set LocalHostName pulse-mac
sudo scutil --set HostName pulse-mac

echo "Letting the Pulse PC in..."
sudo systemsetup -setremotelogin on >/dev/null 2>&1 || true
mkdir -p ~/.ssh && chmod 700 ~/.ssh
touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys
grep -q "pulse-pc-to-mac" ~/.ssh/authorized_keys || echo "__PUBKEY__" >> ~/.ssh/authorized_keys

IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "")
if curl -fsS "https://pulse.orryy.com/mac-hello?user=$(whoami)&ip=${IP}&code=__CODE__" >/dev/null 2>&1; then
  echo ""
  echo "All done. Claude has been told your Mac is ready."
else
  echo ""
  echo "All done. Tell Claude: Mac ready, user $(whoami), address ${IP}"
fi
if ! sudo systemsetup -getremotelogin 2>/dev/null | grep -qi "on"; then
  echo "One last click: System Settings > General > Sharing > turn on Remote Login."
fi
