#!/usr/bin/env bash
# =============================================================================
# generate-cloud-init.sh
#
# Interactively collects the values needed to run `wherever` on a fresh Debian
# 13 (trixie) Hetzner box and writes a ready-to-deploy cloud-init YAML with the
# secrets filled in. Nothing is committed: the output file is git-ignored by
# convention (write it outside the repo, or to deploy/out/ which is ignored).
#
# Every value can be supplied on the CLI so the whole thing runs non-interactively.
# Any NON-secret value left off the CLI is asked interactively (or takes its
# default); secrets (GitHub PAT, wherever token, SSH private key) are asked
# hidden if not supplied. Values can also come from matching env vars.
#
# Options:
#   -o,  --output <file>         Output YAML path (default deploy/out/wherever-cloud-init.yaml, git-ignored)
#        --username <name>       Linux user to create + run wherever as (default wherever)
#        --ssh-key <line>        SSH PUBLIC key line for login (or --ssh-key-file)
#        --ssh-key-file <path>   Read the SSH public key from a file
#        --git-name <name>       git author name (default: username)
#        --git-email <email>     git author email
#        --port <n>              Port to expose wherever on (default 31415)
#        --node-version <n>      Node major version via fnm (default 22)
#        --hostname <name>       Server hostname (default wherever)
#        --gh-token <pat>        GitHub PAT (secret; prompted hidden if omitted)
#        --wherever-token <tok>  wherever auth token (secret; auto-generated if omitted)
#        --git-ssh-key-file <p>  Private key to install for git SSH remotes (optional)
#        --wherever-config <p>   Existing ~/.wherever/config.json to ship as-is
#        --no-wherever-config    Do not create/prompt for a wherever config
#        --domain <fqdn>         Serve behind Caddy at https://<fqdn> with an
#                                auto Let's Encrypt cert (real HTTPS/WSS, no port,
#                                PWA-installable). wherever then runs HTTP on
#                                127.0.0.1 only; public 31415 is NOT opened.
#        --acme-email <email>    Contact email for Let's Encrypt (default: git email)
#        --models-file <path>    pi models.json to install at ~/.pi/models.json
#                                (provider API keys; SECRET). Prompted if omitted.
#        --no-models             Do not install a models.json
#        --settings-file <path>  pi settings.json to install at ~/.pi/agent/settings.json
#                                (default model/provider, packages/extensions).
#                                npm:@wherever-dev/pi is ensured in packages.
#        --pi-package <spec>     Extra pi extension to add to packages (repeatable),
#                                e.g. --pi-package npm:pi-webveil
#        --with-searxng          Install SearXNG (bare, via the upstream installer)
#                                served by uWSGI over a unix HTTP socket, and write
#                                ~/.config/webveil/config.json pointing pi-webveil
#                                at it (egress direct, no proxy). Implies adding
#                                npm:pi-webveil to packages.
#   -y,  --yes                   Non-interactive: never prompt, use defaults/CLI/env
#   -h,  --help                  This help
#
# Examples:
#   ./deploy/generate-cloud-init.sh --username svcuser --ssh-key-file ~/.ssh/id_ed25519.pub \
#     --git-email you@example.com --domain wherever.example.com \
#     --git-ssh-key-file ~/.ssh/box_git_ed25519 --models-file ~/.pi/models.json \
#     --settings-file ~/.pi/agent/settings.json --with-searxng
#   USERNAME=svcuser GH_TOKEN=ghp_xxx WHEREVER_TOKEN=... SSH_KEY="ssh-ed25519 ..." \
#     ./deploy/generate-cloud-init.sh -y -o out.yaml
# =============================================================================
set -euo pipefail

# Default output lives under deploy/out/ (git-ignored) so secrets stay contained.
__SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${__SCRIPT_DIR}/out/wherever-cloud-init.yaml"
ASSUME_YES=""
SSH_KEY_FILE=""
WHEREVER_CONFIG_FILE=""
NO_WHEREVER_CONFIG=""
DOMAIN=""
ACME_EMAIL=""
MODELS_FILE=""
NO_MODELS=""
SETTINGS_FILE=""
PI_PACKAGES_EXTRA=""
WITH_SEARXNG=""
USERNAME_FROM_ARG=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o|--output)          OUT="$2"; shift 2 ;;
    --domain)             DOMAIN="$2"; shift 2 ;;
    --acme-email)         ACME_EMAIL="$2"; shift 2 ;;
    --models-file)        MODELS_FILE="$2"; shift 2 ;;
    --no-models)          NO_MODELS=1; shift ;;
    --settings-file)      SETTINGS_FILE="$2"; shift 2 ;;
    --pi-package)         PI_PACKAGES_EXTRA="${PI_PACKAGES_EXTRA}${PI_PACKAGES_EXTRA:+,}$2"; shift 2 ;;
    --with-searxng)       WITH_SEARXNG=1; shift ;;
    --username)           USERNAME="$2"; USERNAME_FROM_ARG=1; shift 2 ;;
    --ssh-key)            SSH_KEY="$2"; shift 2 ;;
    --ssh-key-file)       SSH_KEY_FILE="$2"; shift 2 ;;
    --git-name)           GIT_USER_NAME="$2"; shift 2 ;;
    --git-email)          GIT_USER_EMAIL="$2"; shift 2 ;;
    --port)               PI_REMOTE_PORT="$2"; shift 2 ;;
    --node-version)       NODE_VERSION="$2"; shift 2 ;;
    --hostname)           HOSTNAME_VAL="$2"; shift 2 ;;
    --gh-token)           GH_TOKEN="$2"; shift 2 ;;
    --wherever-token)     WHEREVER_TOKEN="$2"; shift 2 ;;
    --git-ssh-key-file)   GIT_SSH_KEY_FILE="$2"; shift 2 ;;
    --wherever-config)    WHEREVER_CONFIG_FILE="$2"; shift 2 ;;
    --no-wherever-config) NO_WHEREVER_CONFIG=1; shift ;;
    -y|--yes)             ASSUME_YES=1; shift ;;
    -h|--help)
      # Print only the top banner comment block (between the two ==== rules).
      sed -n '2,/^# ===/{ /^# ===/d; s/^# \{0,1\}//; p; }' "$0"
      exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

# --ssh-key-file convenience: read the public key line from a file.
if [ -z "${SSH_KEY:-}" ] && [ -n "$SSH_KEY_FILE" ]; then
  SSH_KEY_FILE="${SSH_KEY_FILE/#\~/$HOME}"
  [ -r "$SSH_KEY_FILE" ] || { echo "ERROR: cannot read --ssh-key-file: $SSH_KEY_FILE" >&2; exit 1; }
  SSH_KEY="$(head -n1 "$SSH_KEY_FILE")"
fi

# --- helpers ----------------------------------------------------------------
# Interactive only when we have a TTY AND the user did not pass -y/--yes.
is_tty() { [ -z "$ASSUME_YES" ] && [ -t 0 ]; }

# prompt VAR "Question" "default" -> sets global VAR (env value wins if set)
prompt() {
  local __var="$1" __q="$2" __default="${3:-}" __cur __ans
  __cur="${!__var:-}"
  if [ -n "$__cur" ]; then
    printf '%s\n' "$__cur"; return 0            # already provided via env
  fi
  if ! is_tty; then
    if [ -n "$__default" ]; then printf -v "$__var" '%s' "$__default"; return 0; fi
    echo "ERROR: $__var not set and no TTY to prompt (need for: $__q)" >&2; exit 1
  fi
  if [ -n "$__default" ]; then
    read -r -p "$__q [$__default]: " __ans; __ans="${__ans:-$__default}"
  else
    read -r -p "$__q: " __ans
  fi
  printf -v "$__var" '%s' "$__ans"
}

# prompt_secret VAR "Question" -> hidden input (env value wins)
prompt_secret() {
  local __var="$1" __q="$2" __ans
  if [ -n "${!__var:-}" ]; then return 0; fi
  if ! is_tty; then echo "ERROR: $__var not set and no TTY to prompt (need for: $__q)" >&2; exit 1; fi
  read -r -s -p "$__q: " __ans; echo
  printf -v "$__var" '%s' "$__ans"
}

gen_token() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex 32
  elif [ -r /dev/urandom ]; then head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  else echo "ERROR: cannot generate a token (no openssl / urandom)" >&2; exit 1; fi
}

require() { [ -n "${!1:-}" ] || { echo "ERROR: $1 is required" >&2; exit 1; }; }

# Single-quote a value for safe embedding in a shell-`source`d env file, so an
# ordinary space (e.g. a git author name "Jane Q. Public") or other metachar
# cannot break `source` under set -e. Wraps in '...' and escapes embedded '.
shq() { local s=${1//\'/\'\\\'\'}; printf "'%s'" "$s"; }

# Reject values that would break the unquoted YAML heredoc (newline / CR). These
# are operator inputs; fail loudly rather than emit an invalid cloud-init doc.
no_newline() {
  case "${!1:-}" in
    *$'\n'*|*$'\r'*) echo "ERROR: $1 must not contain a newline" >&2; exit 1 ;;
  esac
}

# --- collect values ---------------------------------------------------------
echo "== wherever cloud-init generator =="
echo

# The prompt() helper treats a matching env var as a pre-supplied value. USERNAME
# is commonly exported by the shell (e.g. to the invoking human's login name), so
# honour ONLY an explicit --username or a namespaced WHEREVER_USERNAME; otherwise
# clear an ambient USERNAME so the default applies.
if [ -n "${WHEREVER_USERNAME:-}" ]; then
  USERNAME="${WHEREVER_USERNAME}"
elif [ -z "${USERNAME_FROM_ARG:-}" ]; then
  USERNAME=""
fi

prompt   USERNAME       "Linux username to create (and run wherever as)" "wherever"
prompt   SSH_KEY        "Your SSH public key (ssh-ed25519 / ssh-rsa ...)"
prompt_secret GH_TOKEN  "GitHub personal access token (PAT)"
prompt   GIT_USER_NAME  "git author name" "$USERNAME"
prompt   GIT_USER_EMAIL "git author email"

# wherever auth token: offer to auto-generate.
if [ -z "${WHEREVER_TOKEN:-}" ]; then
  if is_tty; then
    read -r -p "wherever auth token (blank = auto-generate a strong one): " WHEREVER_TOKEN || true
  fi
  if [ -z "${WHEREVER_TOKEN:-}" ]; then WHEREVER_TOKEN="$(gen_token)"; echo "  -> generated token: $WHEREVER_TOKEN"; fi
fi

# Git SSH private key: used so the box can push/pull/clone git SSH remotes
# (git@github.com:...). Provide the PATH to a private key file, or leave blank
# to skip (HTTPS via the gh credential helper still works either way).
# Env override: GIT_SSH_KEY_FILE (path) or GIT_SSH_KEY (raw key contents).
if [ -z "${GIT_SSH_KEY:-}" ]; then
  GIT_SSH_KEY_FILE="${GIT_SSH_KEY_FILE:-}"
  if [ -z "$GIT_SSH_KEY_FILE" ] && is_tty; then
    read -r -p "Path to a git SSH PRIVATE key to install (blank = skip, HTTPS only): " GIT_SSH_KEY_FILE || true
  fi
  if [ -n "$GIT_SSH_KEY_FILE" ]; then
    GIT_SSH_KEY_FILE="${GIT_SSH_KEY_FILE/#\~/$HOME}"
    [ -r "$GIT_SSH_KEY_FILE" ] || { echo "ERROR: cannot read key file: $GIT_SSH_KEY_FILE" >&2; exit 1; }
    GIT_SSH_KEY="$(cat "$GIT_SSH_KEY_FILE")"
  fi
fi
if [ -n "${GIT_SSH_KEY:-}" ]; then
  case "$GIT_SSH_KEY" in
    *"PRIVATE KEY"*) : ;;
    *) echo "WARNING: provided git SSH key does not look like a private key (no 'PRIVATE KEY' marker)." >&2 ;;
  esac
  # Detect the key type for the generated key filename (id_ed25519 vs id_rsa).
  case "$GIT_SSH_KEY" in
    *"OPENSSH PRIVATE KEY"*|*"ED25519"*) GIT_SSH_KEY_NAME="id_ed25519" ;;
    *"RSA PRIVATE KEY"*)                 GIT_SSH_KEY_NAME="id_rsa" ;;
    *)                                    GIT_SSH_KEY_NAME="id_ed25519" ;;
  esac
  # base64 (single line, no wrap) so multi-line key embeds cleanly in YAML.
  GIT_SSH_KEY_B64="$(printf '%s\n' "$GIT_SSH_KEY" | base64 | tr -d '\n')"
fi

prompt   PI_REMOTE_PORT "Port wherever listens on" "31415"
prompt   NODE_VERSION   "Node.js major version (via fnm)" "22"
prompt   HOSTNAME_VAL   "Server hostname" "wherever"

# Optional public domain served by Caddy (real HTTPS/WSS, no port in URL).
if [ -z "$DOMAIN" ] && is_tty; then
  read -r -p "Public domain to serve behind Caddy (e.g. ronan.wherever.dev; blank = expose port directly): " DOMAIN || true
fi
if [ -n "$DOMAIN" ]; then
  # ACME needs a contact email; default to the git author email.
  [ -n "$ACME_EMAIL" ] || ACME_EMAIL="${GIT_USER_EMAIL:-}"
  echo "[caddy] wherever will be served at https://${DOMAIN} (wherever runs HTTP on 127.0.0.1:${PI_REMOTE_PORT})."
  echo "        Make sure an A record ${DOMAIN} -> <box public IP> exists so Let's Encrypt can issue the cert."
fi

# --- pi models (~/.pi/models.json) ------------------------------------------
# The pi agent reads its provider/model config (with API keys) from
# ~/.pi/models.json. SECRET file, handled like the git SSH key: base64-embedded
# and installed by the gh-setup script with the run user's ownership.
MODELS_JSON=""
if [ -z "$NO_MODELS" ]; then
  if [ -z "$MODELS_FILE" ] && is_tty; then
    read -r -p "Path to a pi models.json to install at ~/.pi/models.json (blank = skip): " MODELS_FILE || true
  fi
  if [ -n "$MODELS_FILE" ]; then
    MODELS_FILE="${MODELS_FILE/#\~/$HOME}"
    [ -r "$MODELS_FILE" ] || { echo "ERROR: cannot read --models-file: $MODELS_FILE" >&2; exit 1; }
    if command -v python3 >/dev/null 2>&1; then
      python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$MODELS_FILE" \
        || { echo "ERROR: --models-file is not valid JSON: $MODELS_FILE" >&2; exit 1; }
    fi
    MODELS_JSON="$(cat "$MODELS_FILE")"
    MODELS_B64="$(printf '%s\n' "$MODELS_JSON" | base64 | tr -d '\n')"
    echo "[models] using pi models.json from $MODELS_FILE"
  fi
fi

# --- pi settings (~/.pi/agent/settings.json) --------------------------------
# Ship a settings.json (default model/provider + packages/extensions). We ALWAYS
# ensure npm:@wherever-dev/pi is in packages (the wherever bridge extension),
# append any --pi-package specs, and add npm:pi-webveil when --with-searxng.
# Needs python3 for a reliable JSON merge; without it we fall back to the file
# verbatim (and warn if we could not guarantee the required packages).
if [ -n "$WITH_SEARXNG" ]; then
  PI_PACKAGES_EXTRA="${PI_PACKAGES_EXTRA}${PI_PACKAGES_EXTRA:+,}npm:pi-webveil"
fi
if [ -z "$SETTINGS_FILE" ] && is_tty; then
  read -r -p "Path to a pi settings.json to install at ~/.pi/agent/settings.json (blank = skip): " SETTINGS_FILE || true
fi
SETTINGS_JSON=""
if [ -n "$SETTINGS_FILE" ] || [ -n "$PI_PACKAGES_EXTRA" ]; then
  __src_settings="{}"
  if [ -n "$SETTINGS_FILE" ]; then
    SETTINGS_FILE="${SETTINGS_FILE/#\~/$HOME}"
    [ -r "$SETTINGS_FILE" ] || { echo "ERROR: cannot read --settings-file: $SETTINGS_FILE" >&2; exit 1; }
    __src_settings="$(cat "$SETTINGS_FILE")"
  fi
  if command -v python3 >/dev/null 2>&1; then
    # Write the source to a temp file so python can read the heredoc as its
    # program AND the JSON from a path (piping stdin would collide with <<PY).
    __settings_tmp="$(mktemp)"
    printf '%s' "$__src_settings" > "$__settings_tmp"
    SETTINGS_JSON="$(python3 - "$__settings_tmp" "$PI_PACKAGES_EXTRA" <<'PY'
import json, sys
raw = open(sys.argv[1]).read().strip() or "{}"
try:
    cfg = json.loads(raw)
except Exception as e:
    sys.stderr.write(f"ERROR: --settings-file is not valid JSON: {e}\n"); sys.exit(2)
if not isinstance(cfg, dict):
    sys.stderr.write("ERROR: settings.json must be a JSON object\n"); sys.exit(2)
pkgs = cfg.get("packages")
if not isinstance(pkgs, list):
    pkgs = []
# Always ensure the wherever bridge extension, then any extras (order-preserving, deduped).
want = ["npm:@wherever-dev/pi"] + [p for p in sys.argv[2].split(",") if p]
for p in want:
    if p not in pkgs:
        pkgs.append(p)
cfg["packages"] = pkgs
print(json.dumps(cfg, indent=2))
PY
)" || { rm -f "$__settings_tmp"; echo "ERROR: failed to build settings.json (see above)" >&2; exit 1; }
    rm -f "$__settings_tmp"
    echo "[settings] pi settings.json prepared (packages: ensured @wherever-dev/pi${PI_PACKAGES_EXTRA:+, }$PI_PACKAGES_EXTRA)"
  else
    # No python3: ship the file verbatim if given; cannot guarantee packages.
    SETTINGS_JSON="$__src_settings"
    echo "WARNING: python3 not found; shipping settings.json verbatim. Cannot guarantee npm:@wherever-dev/pi / extra packages are present." >&2
  fi
fi

# --- wherever config (~/.wherever/config.json) ------------------------------
# Three paths:
#   1. --wherever-config <file>  -> ship that file verbatim.
#   2. --no-wherever-config      -> skip entirely.
#   3. otherwise, interactively build a small config (or skip on -y with none).
WHEREVER_CONFIG_JSON=""
if [ -n "$WHEREVER_CONFIG_FILE" ]; then
  WHEREVER_CONFIG_FILE="${WHEREVER_CONFIG_FILE/#\~/$HOME}"
  [ -r "$WHEREVER_CONFIG_FILE" ] || { echo "ERROR: cannot read --wherever-config: $WHEREVER_CONFIG_FILE" >&2; exit 1; }
  # Validate JSON if a parser is available.
  if command -v python3 >/dev/null 2>&1; then
    python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$WHEREVER_CONFIG_FILE" \
      || { echo "ERROR: --wherever-config is not valid JSON: $WHEREVER_CONFIG_FILE" >&2; exit 1; }
  fi
  WHEREVER_CONFIG_JSON="$(cat "$WHEREVER_CONFIG_FILE")"
  echo "[config] using wherever config from $WHEREVER_CONFIG_FILE"
elif [ -z "$NO_WHEREVER_CONFIG" ] && is_tty; then
  read -r -p "Configure ~/.wherever/config.json now? [y/N]: " __cfg || true
  if [ "${__cfg:-}" = "y" ] || [ "${__cfg:-}" = "Y" ]; then
    echo "  (leave any answer blank to accept its default / skip it)"
    read -r -p "  Default 'Initialize Git repository' on new folders? [y/N]: " __gitinit || true
    if [ "${__gitinit:-}" = "y" ] || [ "${__gitinit:-}" = "Y" ]; then __GITINIT=true; else __GITINIT=false; fi

    read -r -p "  commonFolders (comma-separated quick-select paths, blank=none): " __folders || true

    read -r -p "  Auto-create GitHub remote for new folders matching a path? [y/N]: " __ghrules || true
    __RULES="[]"
    if [ "${__ghrules:-}" = "y" ] || [ "${__ghrules:-}" = "Y" ]; then
      read -r -p "    Regex path pattern (default .*): " __pat || true; __pat="${__pat:-.*}"
      read -r -p "    Visibility [private/public] (default private): " __vis || true; __vis="${__vis:-private}"
      __RULES="[{\"pattern\":\"${__pat}\",\"provider\":\"github\",\"visibility\":\"${__vis}\"}]"
    fi

    read -r -p "  Cloud speech-to-text API key (blank=none): " __speechkey || true

    # Build config JSON with python3 for correct escaping/arrays; fallback minimal.
    if command -v python3 >/dev/null 2>&1; then
      WHEREVER_CONFIG_JSON="$(python3 - "$__GITINIT" "$__folders" "$__RULES" "$__speechkey" <<'PY'
import json, sys
gitinit = sys.argv[1] == 'true'
folders = [f.strip() for f in sys.argv[2].split(',') if f.strip()]
rules = json.loads(sys.argv[3])
speechkey = sys.argv[4].strip()
cfg = {"gitInitDefault": gitinit, "commonFolders": folders, "remoteRepoRules": rules}
if speechkey:
    cfg["speech"] = {"apiKey": speechkey}
print(json.dumps(cfg, indent=2))
PY
)"
    else
      WHEREVER_CONFIG_JSON="{\"gitInitDefault\": ${__GITINIT}, \"commonFolders\": [], \"remoteRepoRules\": ${__RULES}}"
    fi
    echo "[config] built wherever config:"; printf '%s\n' "$WHEREVER_CONFIG_JSON" | sed 's/^/    /'
  fi
fi

# --- validate ---------------------------------------------------------------
require USERNAME
require SSH_KEY
require GH_TOKEN
require WHEREVER_TOKEN
require GIT_USER_EMAIL

case "$SSH_KEY" in
  *"PRIVATE KEY"*)
    echo "ERROR: --ssh-key/--ssh-key-file expects your PUBLIC key (the 'ssh-ed25519 AAAA...' line)," >&2
    echo "       but you gave a PRIVATE key. Point it at the .pub file instead, e.g." >&2
    echo "         --ssh-key-file ~/.ssh/id_ed25519.pub" >&2
    echo "       (Your PRIVATE key goes to --git-ssh-key-file, for git push over SSH.)" >&2
    exit 1 ;;
  ssh-ed25519\ *|ssh-rsa\ *|ecdsa-*\ *|ssh-dss\ *|sk-*) : ;;
  *)
    echo "ERROR: --ssh-key does not look like an SSH public key line: '${SSH_KEY:0:24}...'" >&2
    echo "       Expected something like: ssh-ed25519 AAAAC3Nza... you@host" >&2
    exit 1 ;;
esac

# --- build conditional fragments --------------------------------------------
# git SSH key: an extra write_files entry (the base64 blob) + install logic in
# the gh-setup script. Both are empty when no key was provided.
GIT_SSH_KEY_WRITEFILE=""
GIT_SSH_KEY_INSTALL="      echo \"[gh-setup] no git SSH key provided; using HTTPS credential helper only.\""
GH_GIT_PROTOCOL="https"
if [ -n "${GIT_SSH_KEY:-}" ]; then
  GH_GIT_PROTOCOL="ssh"
  GIT_SSH_KEY_WRITEFILE=$(cat <<WF

  - path: /etc/wherever/git_ssh_key.b64
    permissions: "0600"
    owner: root:root
    content: |
      ${GIT_SSH_KEY_B64}
WF
)
  # Install logic injected into the gh-setup heredoc body (6-space indent).
  # Uses literal runtime vars (\${RUN_USER} etc.) that the YAML heredoc keeps.
  GIT_SSH_KEY_INSTALL=$(cat <<'WF'
      echo "[gh-setup] installing git SSH key for ${RUN_USER}"
      install -d -m 0700 -o "${RUN_USER}" -g "${RUN_USER}" "${RUN_HOME}/.ssh"
      base64 -d /etc/wherever/git_ssh_key.b64 > "${RUN_HOME}/.ssh/__KEYNAME__"
      chmod 0600 "${RUN_HOME}/.ssh/__KEYNAME__"
      chown "${RUN_USER}:${RUN_USER}" "${RUN_HOME}/.ssh/__KEYNAME__"
      # Trust github.com host keys (avoids interactive prompt on first push).
      runuser -u "${RUN_USER}" -- env HOME="${RUN_HOME}" bash -c 'ssh-keyscan -t rsa,ecdsa,ed25519 github.com >> "${HOME}/.ssh/known_hosts" 2>/dev/null || true'
      chmod 0644 "${RUN_HOME}/.ssh/known_hosts" 2>/dev/null || true
      chown "${RUN_USER}:${RUN_USER}" "${RUN_HOME}/.ssh/known_hosts" 2>/dev/null || true
      rm -f /etc/wherever/git_ssh_key.b64
WF
)
  # Substitute the concrete key filename picked earlier (id_ed25519 / id_rsa).
  GIT_SSH_KEY_INSTALL="${GIT_SSH_KEY_INSTALL//__KEYNAME__/$GIT_SSH_KEY_NAME}"
fi

# wherever config: staged at /etc/wherever/config.json, then copied into the
# user's ~/.wherever/config.json by the gh-setup script (correct ownership).
WHEREVER_CONFIG_WRITEFILE=""
WHEREVER_CONFIG_INSTALL=""
if [ -n "$WHEREVER_CONFIG_JSON" ]; then
  # Indent every line by 6 spaces to nest under the YAML 'content: |' block.
  __cfg_indented="$(printf '%s\n' "$WHEREVER_CONFIG_JSON" | sed 's/^/      /')"
  WHEREVER_CONFIG_WRITEFILE=$(cat <<WF

  - path: /etc/wherever/config.json
    permissions: "0644"
    owner: root:root
    content: |
${__cfg_indented}
WF
)
  WHEREVER_CONFIG_INSTALL=$(cat <<'WF'
      echo "[gh-setup] installing ~/.wherever/config.json for ${RUN_USER}"
      install -d -m 0700 -o "${RUN_USER}" -g "${RUN_USER}" "${RUN_HOME}/.wherever"
      install -m 0644 -o "${RUN_USER}" -g "${RUN_USER}" /etc/wherever/config.json "${RUN_HOME}/.wherever/config.json"
WF
)
fi

# pi models.json: staged base64 at /etc/wherever/models.b64, decoded into
# ~/.pi/models.json by the gh-setup script with the run user's ownership.
MODELS_WRITEFILE=""
MODELS_INSTALL=""
if [ -n "$MODELS_JSON" ]; then
  MODELS_WRITEFILE=$(cat <<WF

  - path: /etc/wherever/models.b64
    permissions: "0600"
    owner: root:root
    content: |
      ${MODELS_B64}
WF
)
  MODELS_INSTALL=$(cat <<'WF'
      echo "[gh-setup] installing ~/.pi/models.json for ${RUN_USER}"
      install -d -m 0700 -o "${RUN_USER}" -g "${RUN_USER}" "${RUN_HOME}/.pi"
      base64 -d /etc/wherever/models.b64 > "${RUN_HOME}/.pi/models.json"
      chmod 0600 "${RUN_HOME}/.pi/models.json"
      chown "${RUN_USER}:${RUN_USER}" "${RUN_HOME}/.pi/models.json"
      rm -f /etc/wherever/models.b64
WF
)
fi

# pi settings.json: staged base64 at /etc/wherever/settings.b64, decoded into
# ~/.pi/agent/settings.json by the gh-setup script (run user's ownership).
SETTINGS_WRITEFILE=""
SETTINGS_INSTALL=""
if [ -n "$SETTINGS_JSON" ]; then
  SETTINGS_B64="$(printf '%s\n' "$SETTINGS_JSON" | base64 | tr -d '\n')"
  SETTINGS_WRITEFILE=$(cat <<WF

  - path: /etc/wherever/settings.b64
    permissions: "0600"
    owner: root:root
    content: |
      ${SETTINGS_B64}
WF
)
  SETTINGS_INSTALL=$(cat <<'WF'
      echo "[gh-setup] installing ~/.pi/agent/settings.json for ${RUN_USER}"
      install -d -m 0700 -o "${RUN_USER}" -g "${RUN_USER}" "${RUN_HOME}/.pi/agent"
      base64 -d /etc/wherever/settings.b64 > "${RUN_HOME}/.pi/agent/settings.json"
      chmod 0600 "${RUN_HOME}/.pi/agent/settings.json"
      chown "${RUN_USER}:${RUN_USER}" "${RUN_HOME}/.pi/agent/settings.json"
      rm -f /etc/wherever/settings.b64
WF
)
fi

# --- SearXNG (bare) + pi-webveil fragments ----------------------------------
# Installs SearXNG via the upstream installer, serves it with uWSGI over a unix
# HTTP socket (http-socket, so it speaks HTTP, which pi-webveil's unix: baseUrl
# expects), and points pi-webveil at it with egress = direct (no proxy).
SEARXNG_PKG_LINES=""
SEARXNG_WRITEFILES=""
SEARXNG_RUNCMD=""
WEBVEIL_INSTALL=""
if [ -n "$WITH_SEARXNG" ]; then
  SEARXNG_PKG_LINES=$'  - python3-dev\n  - python3-babel\n  - python3-venv\n  - uwsgi\n  - uwsgi-plugin-python3\n  - libxslt-dev\n  - zlib1g-dev\n  - libffi-dev\n  - libssl-dev\n  - build-essential'

  # SearXNG install + uWSGI wiring script (root, runcmd). Mirrors the layout of
  # the upstream bare install: /usr/local/searxng, searx-pyenv venv, uwsgi app
  # bound to /usr/local/searxng/run/socket via http-socket.
  SEARXNG_WRITEFILES=$(cat <<'WF'

  - path: /usr/local/sbin/wherever-searxng-setup.sh
    permissions: "0755"
    owner: root:root
    content: |
      #!/usr/bin/env bash
      set -euo pipefail
      SEARXNG_UID=searxng
      SRC=/usr/local/searxng/searxng-src
      VENV=/usr/local/searxng/searx-pyenv
      RUNDIR=/usr/local/searxng/run
      SOCK="${RUNDIR}/socket"
      SETTINGS=/etc/searxng/settings.yml

      if [ -S "$SOCK" ] && systemctl is-active --quiet uwsgi 2>/dev/null; then
        echo "[searxng-setup] already installed and running; skipping"; exit 0
      fi

      echo "[searxng-setup] creating searxng user + dirs"
      id -u "$SEARXNG_UID" >/dev/null 2>&1 || useradd --system --home-dir /usr/local/searxng --shell /bin/bash "$SEARXNG_UID"
      install -d -o "$SEARXNG_UID" -g "$SEARXNG_UID" /usr/local/searxng
      install -d -o "$SEARXNG_UID" -g "$SEARXNG_UID" "$RUNDIR"

      echo "[searxng-setup] fetching + installing SearXNG into venv"
      if [ ! -d "$SRC/.git" ]; then
        runuser -u "$SEARXNG_UID" -- git clone --depth 1 https://github.com/searxng/searxng "$SRC"
      fi
      runuser -u "$SEARXNG_UID" -- python3 -m venv "$VENV"
      runuser -u "$SEARXNG_UID" -- bash -c "source '$VENV/bin/activate'; pip install -U pip setuptools wheel pyyaml; pip install -e '$SRC'"

      echo "[searxng-setup] writing /etc/searxng/settings.yml"
      install -d -o "$SEARXNG_UID" -g "$SEARXNG_UID" /etc/searxng
      SECRET="$(head -c32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
      cat > "$SETTINGS" <<YML
      use_default_settings: true
      general:
        debug: false
      server:
        secret_key: "${SECRET}"
        limiter: false
        image_proxy: true
      search:
        formats:
          - html
          - json
      YML
      chown "$SEARXNG_UID:$SEARXNG_UID" "$SETTINGS"; chmod 0640 "$SETTINGS"

      echo "[searxng-setup] configuring uWSGI app (unix HTTP socket)"
      install -d /etc/uwsgi/apps-available /etc/uwsgi/apps-enabled
      cat > /etc/uwsgi/apps-available/searxng.ini <<INI
      [uwsgi]
      uid = ${SEARXNG_UID}
      gid = ${SEARXNG_UID}
      env = LANG=C.UTF-8
      env = LANGUAGE=C.UTF-8
      env = LC_ALL=C.UTF-8
      chdir = ${SRC}/searx
      env = SEARXNG_SETTINGS_PATH=${SETTINGS}
      disable-logging = true
      chmod-socket = 666
      single-interpreter = true
      master = true
      lazy-apps = true
      plugin = python3
      enable-threads = true
      workers = %k
      threads = 4
      module = searx.webapp
      virtualenv = ${VENV}
      pythonpath = ${SRC}
      http-socket = ${SOCK}
      buffer-size = 8192
      offload-threads = %k
      INI
      ln -sf /etc/uwsgi/apps-available/searxng.ini /etc/uwsgi/apps-enabled/searxng.ini

      echo "[searxng-setup] starting uWSGI"
      systemctl enable uwsgi 2>/dev/null || true
      systemctl restart uwsgi
      sleep 3
      if [ -S "$SOCK" ]; then echo "[searxng-setup] socket up at $SOCK"; else echo "[searxng-setup] WARNING: socket not present yet at $SOCK"; fi
WF
)

  SEARXNG_RUNCMD="  - bash /usr/local/sbin/wherever-searxng-setup.sh"

  # webveil config for the run user: backend searxng over the unix HTTP socket,
  # both egress paths direct (no Tor/SOCKS on the box).
  WEBVEIL_INSTALL=$(cat <<'WF'
      echo "[gh-setup] installing ~/.config/webveil/config.json for ${RUN_USER}"
      install -d -m 0755 -o "${RUN_USER}" -g "${RUN_USER}" "${RUN_HOME}/.config"
      install -d -m 0755 -o "${RUN_USER}" -g "${RUN_USER}" "${RUN_HOME}/.config/webveil"
      cat > "${RUN_HOME}/.config/webveil/config.json" <<JSON
      {
        "backend": "searxng",
        "baseUrl": "unix:/usr/local/searxng/run/socket",
        "egress": { "mode": "direct" },
        "fetchEgress": { "mode": "direct" }
      }
      JSON
      chown "${RUN_USER}:${RUN_USER}" "${RUN_HOME}/.config/webveil/config.json"
      chmod 0644 "${RUN_HOME}/.config/webveil/config.json"
WF
)
fi

# --- Caddy / domain fragments -----------------------------------------------
# With --domain: wherever runs plain HTTP on loopback and Caddy fronts it on
# 443 with a real Let's Encrypt cert. Without: wherever binds 0.0.0.0 with its
# own self-signed cert and the port is opened publicly (original behaviour).
CADDY_PKG_LINE=""
CADDY_WRITEFILES=""
CADDY_INSTALL_RUNCMD=""
WHEREVER_ENV_HOST="0.0.0.0"
WHEREVER_START_FLAGS="start"
UFW_PORT_RULES="  - ufw allow ${PI_REMOTE_PORT}/tcp"
CLOUD_INIT_NET_NOTE="public on :${PI_REMOTE_PORT}"
FINAL_URL="https://<public-ip>:${PI_REMOTE_PORT}"
if [ -n "$DOMAIN" ]; then
  WHEREVER_ENV_HOST="127.0.0.1"
  # wherever serves plain HTTP on loopback; Caddy terminates TLS.
  WHEREVER_START_FLAGS="start --no-ssl --host 127.0.0.1"
  # Open the web ports for Caddy + ACME; do NOT expose wherever's port.
  UFW_PORT_RULES=$'  - ufw allow 80/tcp\n  - ufw allow 443/tcp'
  CLOUD_INIT_NET_NOTE="behind Caddy at https://${DOMAIN} (wherever HTTP on 127.0.0.1:${PI_REMOTE_PORT})"
  FINAL_URL="https://${DOMAIN}"
  CADDY_PKG_LINE="  - debian-keyring"$'\n'"  - debian-archive-keyring"$'\n'"  - apt-transport-https"

  # Per-site Caddyfile using an import dir, so future services drop in cleanly:
  #   add /etc/caddy/sites/<svc>.caddy and `systemctl reload caddy`.
  CADDY_WRITEFILES=$(cat <<WF

  - path: /etc/caddy/Caddyfile
    permissions: "0644"
    owner: root:root
    content: |
      # Shared reverse proxy. One file per service under sites/*.caddy.
      {
        email ${ACME_EMAIL}
      }
      import /etc/caddy/sites/*.caddy

  - path: /etc/caddy/sites/wherever.caddy
    permissions: "0644"
    owner: root:root
    content: |
      ${DOMAIN} {
        reverse_proxy 127.0.0.1:${PI_REMOTE_PORT}
      }
WF
)

  # Runcmd step: a script that installs Caddy from its official apt repo, then
  # (re)loads the config. Kept as a write_files script so the runcmd line stays
  # a simple one-liner (YAML-safe) rather than a fragile multi-line bash -c.
  CADDY_INSTALL_RUNCMD="  - bash /usr/local/sbin/wherever-caddy-setup.sh"
  CADDY_WRITEFILES="${CADDY_WRITEFILES}"$(cat <<'WF'


  - path: /usr/local/sbin/wherever-caddy-setup.sh
    permissions: "0755"
    owner: root:root
    content: |
      #!/usr/bin/env bash
      set -euo pipefail
      echo "[caddy-setup] installing Caddy from official apt repo"
      install -d -m 0755 /usr/share/keyrings
      curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
        | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
      curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
        -o /etc/apt/sources.list.d/caddy-stable.list
      apt-get update
      apt-get install -y caddy
      mkdir -p /etc/caddy/sites
      systemctl enable caddy
      systemctl reload caddy || systemctl restart caddy
      echo "[caddy-setup] done; serving configured sites on :80/:443"
WF
)
fi

# --- emit -------------------------------------------------------------------
# Everything below is a heredoc; ${...} placeholders are expanded by the shell.

# Guard: operator scalars that land in the unquoted YAML heredoc must not carry
# a newline (would silently produce an invalid cloud-init document).
for __v in USERNAME SSH_KEY HOSTNAME_VAL GIT_USER_NAME GIT_USER_EMAIL WHEREVER_TOKEN GH_TOKEN DOMAIN ACME_EMAIL PI_REMOTE_PORT; do
  no_newline "$__v"
done

# Shell-quote the values that go into the `source`d github.env, so a space or
# metachar in the git author name/email/token cannot break `source` under set -e.
GH_TOKEN_Q="$(shq "${GH_TOKEN}")"
GIT_USER_NAME_Q="$(shq "${GIT_USER_NAME}")"
GIT_USER_EMAIL_Q="$(shq "${GIT_USER_EMAIL}")"

mkdir -p "$(dirname "$OUT")"
cat > "$OUT" <<YAML
#cloud-config
# Generated by deploy/generate-cloud-init.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ)
# Runs wherever on Debian 13 (trixie) for user "${USERNAME}", ${CLOUD_INIT_NET_NOTE}.
# CONTAINS SECRETS (wherever token + GitHub PAT). Do NOT commit this file.

hostname: ${HOSTNAME_VAL}
timezone: UTC

users:
  - name: ${USERNAME}
    groups: [sudo]
    shell: /bin/bash
    sudo: ["ALL=(ALL) NOPASSWD:ALL"]
    # Key-only account. lock_passwd keeps it passwordless WITHOUT marking the
    # password 'expired' (which would make PAM block runuser / sudo -u on a
    # non-interactive tty). The bootstrap also clears any password aging.
    lock_passwd: true
    ssh_authorized_keys:
      - ${SSH_KEY}

package_update: true
package_upgrade: true
packages:
  - curl
  - unzip
  - git
  - openssl
  - ca-certificates
  - gnupg
  - ufw
${CADDY_PKG_LINE}${SEARXNG_PKG_LINES}

write_files:
  # NOTE: owner is root:root here on purpose. write_files runs in cloud-init's
  # init stage, BEFORE the users: module creates ${USERNAME}, so referencing
  # that group here fails the whole module (and aborts runcmd). The bootstrap
  # script (runcmd, after users exist) chgrp's this file to ${USERNAME}.
  - path: /etc/wherever/wherever.env
    permissions: "0640"
    owner: root:root
    content: |
      PI_REMOTE_TOKEN=${WHEREVER_TOKEN}
      PI_REMOTE_HOST=${WHEREVER_ENV_HOST}
      PI_REMOTE_PORT=${PI_REMOTE_PORT}

  - path: /etc/wherever/versions.env
    permissions: "0644"
    owner: root:root
    content: |
      NODE_VERSION=${NODE_VERSION}

  - path: /etc/wherever/github.env
    permissions: "0600"
    owner: root:root
    content: |
      GH_TOKEN=${GH_TOKEN_Q}
      GIT_USER_NAME=${GIT_USER_NAME_Q}
      GIT_USER_EMAIL=${GIT_USER_EMAIL_Q}
${GIT_SSH_KEY_WRITEFILE}${WHEREVER_CONFIG_WRITEFILE}${MODELS_WRITEFILE}${SETTINGS_WRITEFILE}${CADDY_WRITEFILES}${SEARXNG_WRITEFILES}

  - path: /usr/local/sbin/wherever-bootstrap.sh
    permissions: "0755"
    owner: root:root
    content: |
      #!/usr/bin/env bash
      set -euo pipefail

      # shellcheck disable=SC1091
      source /etc/wherever/versions.env

      RUN_USER=${USERNAME}
      RUN_HOME=/home/\${RUN_USER}
      FNM_DIR="\${RUN_HOME}/.local/share/fnm"

      # write_files created this as root:root (user didn't exist yet); the
      # systemd service reads it as \${RUN_USER}, so fix the group now.
      chgrp "\${RUN_USER}" /etc/wherever/wherever.env || true
      chmod 0640 /etc/wherever/wherever.env || true

      # Belt-and-suspenders: make sure the account is unlocked and has no
      # password aging/expiry, so runuser/sudo -u work non-interactively.
      passwd -u "\${RUN_USER}" 2>/dev/null || true
      chage -M -1 -E -1 "\${RUN_USER}" 2>/dev/null || true

      echo "[wherever-bootstrap] installing fnm for \${RUN_USER}"
      runuser -u "\${RUN_USER}" -- env HOME="\${RUN_HOME}" bash -c '
        set -euo pipefail
        curl -fsSL https://fnm.vercel.app/install | bash -s -- --skip-shell
      '

      FNM_BIN="\${RUN_HOME}/.local/share/fnm/fnm"
      if [ ! -x "\${FNM_BIN}" ]; then
        FNM_BIN="\${RUN_HOME}/.fnm/fnm"
      fi

      echo "[wherever-bootstrap] installing node \${NODE_VERSION} via fnm"
      runuser -u "\${RUN_USER}" -- env HOME="\${RUN_HOME}" FNM_DIR="\${FNM_DIR}" "\${FNM_BIN}" install "\${NODE_VERSION}"
      runuser -u "\${RUN_USER}" -- env HOME="\${RUN_HOME}" FNM_DIR="\${FNM_DIR}" "\${FNM_BIN}" default "\${NODE_VERSION}"

      NODE_BIN_DIR="\$(runuser -u "\${RUN_USER}" -- env HOME="\${RUN_HOME}" FNM_DIR="\${FNM_DIR}" bash -c "
        eval \\"\\\$('\${FNM_BIN}' env --shell bash)\\"
        '\${FNM_BIN}' use \${NODE_VERSION} >/dev/null
        dirname \\"\\\$(command -v node)\\"
      ")"
      echo "[wherever-bootstrap] node bin dir: \${NODE_BIN_DIR}"

      echo "[wherever-bootstrap] installing wherever-dev globally"
      runuser -u "\${RUN_USER}" -- env HOME="\${RUN_HOME}" PATH="\${NODE_BIN_DIR}:\${PATH}" \\
        npm install -g wherever-dev@latest

      echo "[wherever-bootstrap] writing systemd unit"
      cat > /etc/systemd/system/wherever.service <<UNIT
      [Unit]
      Description=Wherever multi-session server for the pi coding agent
      After=network-online.target
      Wants=network-online.target

      [Service]
      Type=simple
      User=\${RUN_USER}
      Group=\${RUN_USER}
      Environment=HOME=\${RUN_HOME}
      Environment=PATH=\${NODE_BIN_DIR}:/usr/local/bin:/usr/bin:/bin
      EnvironmentFile=/etc/wherever/wherever.env
      WorkingDirectory=\${RUN_HOME}
      ExecStart=\${NODE_BIN_DIR}/wherever ${WHEREVER_START_FLAGS}
      Restart=on-failure
      RestartSec=3
      NoNewPrivileges=true
      ProtectSystem=full
      ProtectHome=false

      [Install]
      WantedBy=multi-user.target
      UNIT

      systemctl daemon-reload
      systemctl enable --now wherever.service
      echo "[wherever-bootstrap] done. status:"
      systemctl --no-pager status wherever.service || true

  - path: /usr/local/sbin/wherever-gh-setup.sh
    permissions: "0755"
    owner: root:root
    content: |
      #!/usr/bin/env bash
      set -euo pipefail

      RUN_USER=${USERNAME}
      RUN_HOME=/home/\${RUN_USER}

      # shellcheck disable=SC1091
      source /etc/wherever/github.env

      echo "[gh-setup] adding GitHub CLI apt repository"
      install -d -m 0755 /etc/apt/keyrings
      curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \\
        | tee /etc/apt/keyrings/githubcli-archive-keyring.gpg >/dev/null
      chmod 0644 /etc/apt/keyrings/githubcli-archive-keyring.gpg
      echo "deb [arch=\$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \\
        > /etc/apt/sources.list.d/github-cli.list
      apt-get update
      apt-get install -y gh

      runuser -u "\${RUN_USER}" -- env HOME="\${RUN_HOME}" git config --global user.name "\${GIT_USER_NAME}"
      runuser -u "\${RUN_USER}" -- env HOME="\${RUN_HOME}" git config --global user.email "\${GIT_USER_EMAIL}"

${GIT_SSH_KEY_INSTALL}
${WHEREVER_CONFIG_INSTALL}
${MODELS_INSTALL}
${SETTINGS_INSTALL}
${WEBVEIL_INSTALL}

      if [ -n "\${GH_TOKEN:-}" ]; then
        echo "[gh-setup] authenticating gh for \${RUN_USER}"
        printf '%s' "\${GH_TOKEN}" \\
          | runuser -u "\${RUN_USER}" -- env HOME="\${RUN_HOME}" gh auth login --hostname github.com --git-protocol ${GH_GIT_PROTOCOL} --with-token
        runuser -u "\${RUN_USER}" -- env HOME="\${RUN_HOME}" gh auth setup-git
        runuser -u "\${RUN_USER}" -- env HOME="\${RUN_HOME}" gh auth status || true
      else
        echo "[gh-setup] GH_TOKEN empty; skipping gh auth."
      fi

runcmd:
  - ufw allow 22/tcp
${UFW_PORT_RULES}
  - ufw --force enable
  - bash /usr/local/sbin/wherever-gh-setup.sh
  - bash /usr/local/sbin/wherever-bootstrap.sh
${CADDY_INSTALL_RUNCMD}
${SEARXNG_RUNCMD}

final_message: "wherever cloud-init finished after \$UPTIME s. Open ${FINAL_URL} and authenticate with your token."
YAML

chmod 600 "$OUT" 2>/dev/null || true

echo
echo "Wrote $OUT (mode 0600 - contains secrets, do not commit)."
echo
echo "Deploy with hcloud:"
echo "  hcloud server create --name ${HOSTNAME_VAL} --type cx22 --image debian-13 \\"
echo "    --ssh-key <your-key-name> --user-data-from-file \"$OUT\""
echo
echo "After boot, open: https://<public-ip>:${PI_REMOTE_PORT}"
echo "wherever token:   ${WHEREVER_TOKEN}"
if [ -n "${GIT_SSH_KEY:-}" ]; then echo "git SSH key:      installed (gh uses ssh protocol)"; fi
if [ -n "$WHEREVER_CONFIG_JSON" ]; then echo "wherever config:  shipped to ~/.wherever/config.json"; fi
