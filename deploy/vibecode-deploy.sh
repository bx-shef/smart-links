#!/usr/bin/env bash
# vibecode-deploy.sh — deploy this Nuxt 4 / Nitro app to a Bitrix24 Vibecode "Black Hole" server.
#
# Idempotent: finds a server by APP_NAME, creates it if missing, waits until the tunnel is
# CONNECTED, then runs a full deploy (install -> optional preStart -> start on :3000). Source is
# pulled straight from a public archive URL, so no git credentials are needed on the VM.
#
# Required (env):
#   VIBE_KEY     vibe_api_...  (personal key; owns the server + billing)
#   APP_NAME     server/app name, e.g. "smart-links"
#   SOURCE_URL   tar.gz of the exact commit, e.g.
#                https://codeload.github.com/bx-shef/smart-links/tar.gz/<sha>
# Optional (env, with defaults):
#   ENV_JSON     JSON object of env for the app (default {}). NUXT_PUBLIC_* keys are also baked
#                into the BUILD step — see the note by the body builder below.
#   VIBE_BASE    default https://vibecode.bitrix24.tech/v1
#   VIBE_PLAN    default bc-micro   (the only plan allowed on RU/BY demo access)
#   VIBE_REGION  default ru-central1-b
#   VIBE_RUNTIME default node22
#   INSTALL_CMD  default: corepack enable && pnpm install --frozen-lockfile --prod=false && pnpm build
#   PRESTART_CMD default: (empty) — put Postgres provisioning here if the rating store is wanted
#   START_CMD    default: HOST=0.0.0.0 PORT=3000 node .output/server/index.mjs
#   PORT         default 3000  (Black Hole always tunnels :3000 — don't change without reason)
#   ACCESS_POLICY default PUBLIC — required: portals load the app in a cross-origin iframe
#
# NOTE: written against the documented Deploy API (docs: /docs/infra, /docs/infra/deploy). Run the
# FIRST deploy interactively and verify it (see docs/DEPLOY_VIBECODE.md) before trusting it in CI.

set -euo pipefail

: "${VIBE_KEY:?set VIBE_KEY (vibe_api_...)}"
: "${APP_NAME:?set APP_NAME}"
: "${SOURCE_URL:?set SOURCE_URL (public tar.gz of the build context)}"
: "${ENV_JSON:={}}"

BASE="${VIBE_BASE:-https://vibecode.bitrix24.tech/v1}"
PLAN="${VIBE_PLAN:-bc-micro}"
REGION="${VIBE_REGION:-ru-central1-b}"
RUNTIME="${VIBE_RUNTIME:-node22}"
# --prod=false: `nuxt build` loads build-only modules (@nuxt/eslint) that live in devDependencies.
# If the platform defaults NODE_ENV=production for the install step, a prod-only install drops them
# and the build dies with "Cannot find module '@nuxt/eslint'". Force devDeps in for the build.
INSTALL_CMD="${INSTALL_CMD:-cd /opt/app && corepack enable && pnpm install --frozen-lockfile --prod=false && pnpm build}"
PRESTART_CMD="${PRESTART_CMD:-}"
START_CMD="${START_CMD:-cd /opt/app && HOST=0.0.0.0 PORT=3000 node .output/server/index.mjs}"
PORT="${PORT:-3000}"
ACCESS_POLICY="${ACCESS_POLICY:-PUBLIC}"

# The Python heredoc below reads these from os.environ; plain shell vars are NOT inherited by a
# child process, so they must be exported or the body builder dies with KeyError.
export RUNTIME INSTALL_CMD START_CMD PORT ENV_JSON SOURCE_URL PRESTART_CMD

# --connect-timeout bounds a hung connect so the wait loop can't stall forever. No --max-time: the
# deploy POST with ?stream=false blocks until install+build finish, which legitimately takes minutes.
api() { curl -fsS --connect-timeout 15 -H "X-Api-Key: $VIBE_KEY" "$@"; }

echo "==> Looking up server '$APP_NAME'"
sid="$(APP_NAME="$APP_NAME" api "$BASE/infra/servers" | python3 -c '
import sys, json, os
d = json.load(sys.stdin)
name = os.environ["APP_NAME"]
print(next((s["id"] for s in d.get("data", []) if s.get("name") == name), ""))
')"

if [ -z "$sid" ]; then
  echo "==> Not found. Creating (provider=bitrix-cloud plan=$PLAN region=$REGION)"
  sid="$(api -X POST "$BASE/infra/servers" -H 'Content-Type: application/json' \
    -d "{\"provider\":\"bitrix-cloud\",\"name\":\"$APP_NAME\",\"plan\":\"$PLAN\",\"region\":\"$REGION\"}" \
    | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["id"])')"
fi
echo "    server id: $sid"

echo "==> Waiting for status=running AND blackholeStatus=CONNECTED"
st=""; bh=""
for _ in $(seq 1 90); do
  # `|| true`: a transient poll error must not trip set -e/pipefail and abort the deploy mid-wait.
  line="$(api "$BASE/infra/servers/$sid" \
    | python3 -c 'import sys,json;d=json.load(sys.stdin)["data"];print(d.get("status"),d.get("blackholeStatus"))' 2>/dev/null || true)"
  read -r st bh <<<"$line" || true
  echo "    status=${st:-?} blackhole=${bh:-?}"
  [ "${st:-}" = "running" ] && [ "${bh:-}" = "CONNECTED" ] && break
  [ "${st:-}" = "error" ] && { echo "server entered error state"; exit 1; }
  sleep 10
done
# Timed out without CONNECTED → do NOT deploy against a server that is not ready.
[ "${st:-}" = "running" ] && [ "${bh:-}" = "CONNECTED" ] || {
  echo "timed out waiting for running+CONNECTED (last: status=${st:-?} blackhole=${bh:-?})"; exit 1
}

echo "==> Setting accessPolicy=$ACCESS_POLICY"
# PUBLIC is required (portals load the app in a cross-origin iframe), but this call is SOFT on
# purpose: the exact access-policy endpoint/shape must be confirmed on the first live run. A failure
# here does NOT abort the deploy — VERIFY the policy really is PUBLIC in the cabinet afterwards.
api -X PATCH "$BASE/infra/servers/$sid/access-policy" -H 'Content-Type: application/json' \
  -d "{\"accessPolicy\":\"$ACCESS_POLICY\"}" >/dev/null || \
  echo "    (access-policy call failed — set it MANUALLY in the cabinet; PUBLIC is required)"

echo "==> Deploying"
body="$(python3 - <<'PY'
import json, os, shlex
d = {
    "source":  {"url": os.environ["SOURCE_URL"]},
    "runtime": os.environ["RUNTIME"],
    "install": os.environ["INSTALL_CMD"],
    "start":   os.environ["START_CMD"],
    "port":    int(os.environ["PORT"]),
    "env":     json.loads(os.environ["ENV_JSON"]),
}
# Every NUXT_PUBLIC_* value is frozen into the prerendered HTML at BUILD time, so passing it only as
# runtime `env` leaves it EMPTY in the served pages and the feature silently switches off (landing
# canonical/og:url, the rating popup, the feedback form). Bake them into the build command so one
# ENV_JSON drives both steps regardless of whether the platform forwards deploy `env` to install.
public = {k: v for k, v in d["env"].items() if k.startswith("NUXT_PUBLIC_") and v}
if public and "pnpm build" in d["install"]:
    prefix = " ".join(f"{k}={shlex.quote(str(v))}" for k, v in sorted(public.items()))
    d["install"] = d["install"].replace("pnpm build", f"{prefix} pnpm build", 1)
pre = os.environ.get("PRESTART_CMD", "")
if pre:
    d["preStart"] = pre
print(json.dumps(d))
PY
)"

api -X POST "$BASE/infra/servers/$sid/deploy?stream=false" \
  -H 'Content-Type: application/json' \
  -H 'X-Skip-Source-Snapshot: CI deploy from public archive' \
  -d "$body" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print("==> appUrl:",d.get("data",{}).get("appUrl","<none>"))'

echo "==> Done. Health: curl <appUrl>/api/health"
echo "==> FIRST DEPLOY checklist (docs/DEPLOY_VIBECODE.md):"
echo "    1. <appUrl>/api/health returns {\"status\":\"ok\"}"
echo "    2. <appUrl>/ serves the landing; response carries Content-Security-Policy"
echo "       (empty ⇒ APP_EDGE_SECURITY=1 was missing from ENV_JSON)"
echo "    3. Portal app path = <appUrl>/app, install path = <appUrl>/install"
