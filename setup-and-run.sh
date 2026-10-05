#!/usr/bin/env bash
# Installs missing prerequisites (Homebrew, Node.js, PostgreSQL), prepares the
# database and .env, installs npm packages, and starts the Expense Tracker.
# Safe to re-run: every step is skipped if already done.
#
# Usage:  ./setup-and-run.sh          # setup + start the server
#         ./setup-and-run.sh --dev    # setup + start with auto-restart on changes
set -euo pipefail

cd "$(dirname "$0")"

PG_FORMULA="postgresql@16"
DB_NAME="expenses"
PORT="${PORT:-3000}"

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m ✓\033[0m  %s\n' "$*"; }
warn() { printf '\033[1;33m !\033[0m  %s\n' "$*"; }
die()  { printf '\033[1;31m ✗\033[0m  %s\n' "$*" >&2; exit 1; }

[[ "$(uname)" == "Darwin" ]] || die "This script supports macOS only (it uses Homebrew)."

# ── Homebrew ─────────────────────────────────────────────────────────────────
if ! command -v brew >/dev/null 2>&1; then
  for p in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    [[ -x "$p" ]] && eval "$("$p" shellenv)" && break
  done
fi
if ! command -v brew >/dev/null 2>&1; then
  info "Installing Homebrew (may ask for your password)..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  for p in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    [[ -x "$p" ]] && eval "$("$p" shellenv)" && break
  done
fi
command -v brew >/dev/null 2>&1 || die "Homebrew installation failed."
ok "Homebrew"

# ── Node.js ──────────────────────────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  info "Installing Node.js..."
  brew install node
fi
ok "Node.js $(node -v)"

# ── PostgreSQL ───────────────────────────────────────────────────────────────
if ! brew list --versions "$PG_FORMULA" >/dev/null 2>&1; then
  info "Installing $PG_FORMULA..."
  brew install "$PG_FORMULA"
fi
PG_BIN="$(brew --prefix "$PG_FORMULA")/bin"
export PATH="$PG_BIN:$PATH"
ok "PostgreSQL $(psql --version | awk '{print $3}')"

if ! pg_isready -q -h localhost; then
  info "Starting PostgreSQL..."
  brew services start "$PG_FORMULA" >/dev/null
  for _ in $(seq 1 30); do
    pg_isready -q -h localhost && break
    sleep 1
  done
fi
pg_isready -q -h localhost || die "PostgreSQL did not start. Try: brew services restart $PG_FORMULA"
ok "PostgreSQL is running"

# ── Database ─────────────────────────────────────────────────────────────────
if psql -h localhost -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1; then
  ok "Database '$DB_NAME' exists"
else
  info "Creating database '$DB_NAME'..."
  createdb -h localhost "$DB_NAME"
  ok "Database '$DB_NAME' created"
fi

# ── .env ─────────────────────────────────────────────────────────────────────
if [[ ! -f .env ]]; then
  info "Creating .env from .env.example..."
  cp .env.example .env
  SECRET="$(openssl rand -hex 32)"
  sed -i '' "s|^SESSION_SECRET=.*|SESSION_SECRET=$SECRET|" .env
  sed -i '' "s|^BASE_URL=.*|BASE_URL=http://localhost:$PORT|" .env
fi

env_get() { grep -E "^$1=" .env | head -1 | cut -d= -f2-; }
env_set() { sed -i '' "s|^$1=.*|$1=$2|" .env; }

CLIENT_ID="$(env_get GOOGLE_CLIENT_ID)"
if [[ -z "$CLIENT_ID" || "$CLIENT_ID" == "your-google-client-id" ]]; then
  cat <<EOF

Google sign-in needs OAuth credentials (the app cannot work without them):
  1. Open https://console.cloud.google.com/apis/credentials
  2. Create Credentials -> OAuth client ID -> Web application
  3. Add this Authorized redirect URI:
       http://localhost:$PORT/auth/google/callback
  4. Paste the Client ID and Client Secret below.

EOF
  [[ -t 0 ]] || die "No terminal to prompt on. Edit .env and set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET, then re-run."
  read -r -p "Google Client ID: " CLIENT_ID
  read -r -s -p "Google Client Secret: " CLIENT_SECRET; echo
  [[ -n "$CLIENT_ID" && -n "$CLIENT_SECRET" ]] || die "Both values are required."
  env_set GOOGLE_CLIENT_ID "$CLIENT_ID"
  env_set GOOGLE_CLIENT_SECRET "$CLIENT_SECRET"
fi
ok ".env configured"

# ── npm dependencies ─────────────────────────────────────────────────────────
if [[ ! -d node_modules || package-lock.json -nt node_modules ]]; then
  info "Installing npm dependencies..."
  npm install
  touch node_modules
fi
ok "npm dependencies"

# ── Start ────────────────────────────────────────────────────────────────────
info "Starting the app at http://localhost:$PORT/expenses.html  (Ctrl+C to stop)"
(sleep 3 && open "http://localhost:$PORT/expenses.html") >/dev/null 2>&1 &
if [[ "${1:-}" == "--dev" ]]; then
  exec npm run dev
else
  exec npm start
fi
