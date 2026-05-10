#!/usr/bin/env bash
# Post-create setup for the GitHub Codespace.
# Installs the LiveKit CLI, Python deps, Node deps; pre-downloads the
# Silero VAD + turn-detector weights so `python agent.py dev` is instant.

set -euo pipefail

echo "==> Installing LiveKit CLI (lk)"
curl -sSL https://get.livekit.io/cli | bash
# Move into PATH if installed in /root or $HOME/.local/bin
if [ -f "$HOME/bin/lk" ]; then
  sudo mv "$HOME/bin/lk" /usr/local/bin/lk || true
fi
lk --version || echo "lk install: check manually"

echo "==> Python deps for the agent"
pip install --upgrade pip
pip install -r agent/requirements.txt

echo "==> Pre-downloading Silero VAD + turn-detector weights"
( cd agent && python agent.py download-files ) || \
  echo "(skipped — env vars not set yet, ok)"

echo "==> Node deps for the front"
( cd web && npm install --no-audit --no-fund )

echo
echo "Codespace ready."
echo
echo "Next steps:"
echo "  1) cp agent/.env.example agent/.env   # then fill in keys"
echo "  2) cp web/.env.example  web/.env.local"
echo "  3) lk cloud auth                       # browser-based auth"
echo "  4) cd agent && lk agent create         # deploy the worker"
echo "  5) (alt) cd agent && python agent.py dev   # run worker locally"
echo "  6) cd web && npm run dev               # run front locally on port 3000"
