#!/bin/sh
set -eu

cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
runtime="$PWD/.paperclip-local/pi"

if [ ! -x "$runtime/node_modules/.bin/pi" ]; then
  printf '%s\n' 'Устанавливаем локальный движок Pi. Интернет нужен только для первой установки.'
  npm install --prefix "$runtime" --no-audit --no-fund --save-exact @earendil-works/pi-coding-agent@0.74.0
fi

mkdir -p "$PWD/.paperclip-local/bin"
corepack enable --install-directory "$PWD/.paperclip-local/bin" pnpm
export PATH="$PWD/.paperclip-local/bin:$runtime/node_modules/.bin:$PATH"
export PAPERCLIP_HOME="${PAPERCLIP_HOME:-$PWD/.paperclip-local/state}"
export PAPERCLIP_TELEMETRY_DISABLED=1
export PAPERCLIP_ANNOUNCEMENTS_ENABLED=false
export PAPERCLIP_UPDATE_CHECK=0
node cli/node_modules/tsx/dist/cli.mjs --eval 'import { ensureAgentJwtSecret, ensureToolActionSigningSecret } from "./cli/src/config/env.ts"; ensureAgentJwtSecret(); ensureToolActionSigningSecret();'
exec corepack pnpm dev:once "$@"
