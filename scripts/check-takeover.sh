#!/usr/bin/env bash
# Read-only report on who currently owns this machine's network, and whether the
# handover is in a state that can actually carry traffic. Changes nothing, so it
# is safe to run at any point - before a switch, halfway through, or when the
# browser has stopped loading pages and it is not obvious why.
set -uo pipefail

APP_DIR="$HOME/Library/Application Support/com.openn.app.dev"
PROBLEMS=0

say()  { printf '\n\033[1m%s\033[0m\n' "$1"; }
bad()  { printf '  \033[31m✗ %s\033[0m\n' "$1"; PROBLEMS=$((PROBLEMS + 1)); }
good() { printf '  \033[32m✓ %s\033[0m\n' "$1"; }
note() { printf '    %s\n' "$1"; }

# Anything inherited here would silently redirect our own probes.
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy NO_PROXY no_proxy

listening() { nc -z 127.0.0.1 "$1" >/dev/null 2>&1; }

say "Who owns the default route"
ROUTE_IF="$(route -n get default 2>/dev/null | awk -F': ' '/interface:/{print $2; exit}')"
if [ -z "$ROUTE_IF" ]; then
  bad "no default route at all - this machine is offline"
elif [[ "$ROUTE_IF" == utun* ]]; then
  good "a tunnel holds it ($ROUTE_IF)"
  ifconfig "$ROUTE_IF" 2>/dev/null | awk '/inet /{print "    address: "$2}'
else
  good "no tunnel - traffic goes out $ROUTE_IF directly"
fi

say "System proxy (read through scutil, not networksetup)"
# A VPN that installs its proxy through NetworkExtension scopes it to its own
# tunnel, where networksetup reports nothing. scutil sees the resolved value.
PROXY_ON="$(scutil --proxy | awk -F': ' '/HTTPEnable/{print $2; exit}')"
PROXY_PORT="$(scutil --proxy | awk -F': ' '/HTTPPort/{print $2; exit}')"
if [ "${PROXY_ON:-0}" != "1" ]; then
  good "off - applications go straight out, or through whatever tunnel holds the route"
else
  if listening "${PROXY_PORT:-0}"; then
    good "points at 127.0.0.1:$PROXY_PORT, and something is listening there"
  else
    bad "points at 127.0.0.1:$PROXY_PORT but NOTHING IS LISTENING THERE"
    note "Every app that follows the system proxy fails with ERR_PROXY_CONNECTION_FAILED."
    note "This is what a proxy app leaves behind when it is force-quit instead of"
    note "being disconnected from its own UI first."
  fi
fi

say "Session-wide proxy variables"
FOUND_ENV=0
for var in HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy; do
  value="$(launchctl getenv "$var" 2>/dev/null || true)"
  if [ -n "$value" ]; then
    FOUND_ENV=1
    port="${value##*:}"
    if listening "${port%%/*}"; then
      note "$var=$value (listener present)"
    else
      bad "$var=$value - nothing listening on that port"
    fi
  fi
done
[ "$FOUND_ENV" -eq 0 ] && good "none set for newly launched apps"
note "Apps already running keep whatever they inherited until they restart."

say "Proxy apps present"
for name in Shadowrocket "Clash Verge" ShadowsocksX-NG ClashX; do
  pgrep -x "$name" >/dev/null 2>&1 && note "running: $name"
done
pgrep -f "target/debug/clash-verge" >/dev/null 2>&1 && note "running: Openn (dev build)"
pgrep -f "cores/verge-mihomo" >/dev/null 2>&1 && note "running: Openn core (verge-mihomo)"

say "Openn's own port agreement"
# The system proxy is set from verge.yaml while the core is launched from
# config.yaml. If the two disagree, Openn points the system at a port its own
# core is not listening on - connected UI, dead network.
VERGE_PORT="$(awk -F': ' '/^verge_mixed_port:/{print $2; exit}' "$APP_DIR/verge.yaml" 2>/dev/null)"
CLASH_PORT="$(awk -F': ' '/^mixed-port:/{print $2; exit}' "$APP_DIR/config.yaml" 2>/dev/null)"
if [ -z "$VERGE_PORT" ] || [ -z "$CLASH_PORT" ]; then
  note "could not read both files - skipping"
elif [ "$VERGE_PORT" = "$CLASH_PORT" ]; then
  good "verge.yaml and config.yaml agree on $CLASH_PORT"
  if listening "$CLASH_PORT"; then
    good "the core is listening on $CLASH_PORT"
  else
    bad "nothing is listening on $CLASH_PORT"
    note "The core has not picked this port up. Restart Openn."
  fi
else
  bad "verge.yaml says $VERGE_PORT but config.yaml says $CLASH_PORT"
  note "Openn will point the system proxy at $VERGE_PORT while its core listens"
  note "on $CLASH_PORT. Make both files agree, then restart Openn."
fi

say "Can anything actually reach the internet"
probe() { # label, curl args...
  local label="$1"; shift
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$@" 2>/dev/null)" || code="failed"
  [ "$code" = "200" ] || [ "$code" = "204" ] && good "$label -> $code" || bad "$label -> $code"
}
probe "direct    baidu " --noproxy '*' https://www.baidu.com/
probe "direct    google" --noproxy '*' https://www.google.com/generate_204
if [ "${PROXY_ON:-0}" = "1" ] && [ -n "${PROXY_PORT:-}" ]; then
  probe "sysproxy  google" -x "http://127.0.0.1:$PROXY_PORT" https://www.google.com/generate_204
fi
if [ -n "${CLASH_PORT:-}" ] && listening "$CLASH_PORT"; then
  probe "openn     baidu " -x "http://127.0.0.1:$CLASH_PORT" https://www.baidu.com/
  probe "openn     google" -x "http://127.0.0.1:$CLASH_PORT" https://www.google.com/generate_204
  printf '    exit IP through Openn: '
  curl -sS --max-time 10 -x "http://127.0.0.1:$CLASH_PORT" https://api.ipify.org 2>/dev/null || printf 'unreachable'
  echo
fi

if [ "$PROBLEMS" -eq 0 ]; then
  printf '\n\033[32mNothing wrong found.\033[0m\n'
else
  printf '\n\033[31m%d problem(s) above.\033[0m\n' "$PROBLEMS"
fi
