#!/usr/bin/env bash
#
# Switch the running Wherever setup between:
#
#   dev    - use the LOCAL repo build of the @wherever-dev/pi extension (so a
#            CLI-bridge pi picks up your uncommitted changes), stop the systemd
#            server, build the repo, and run the repo server in the foreground.
#
#   normal - restore the PUBLISHED @wherever-dev/pi extension and (re)start the
#            systemd `wherever` user service.
#
#   status - print which extension dist is currently active and whether the
#            systemd service is running.
#
# The extension your pi loads lives at
#   ~/.pi/agent/npm/node_modules/@wherever-dev/pi/dist
# and is normally the published npm package. `dev` replaces that `dist` with a
# symlink to your repo's built extension/dist, backing up the published copy to
# `dist.published`. `normal` reverses it. The swap is fully reversible and only
# ever moves the published dist aside (never deletes it).
#
# Usage:
#   scripts/dev-switch.sh dev
#   scripts/dev-switch.sh normal
#   scripts/dev-switch.sh status
#
set -euo pipefail

# --- Config ----------------------------------------------------------------
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_EXT_DIST="${REPO_ROOT}/extension/dist"

PKG_DIR="${HOME}/.pi/agent/npm/node_modules/@wherever-dev/pi"
DIST="${PKG_DIR}/dist"
DIST_BACKUP="${PKG_DIR}/dist.published"

SERVICE="wherever.service"

# Server dev command (matches package.json server:dev + your requested flags).
SERVER_DEV_CMD=(pnpm server:dev --host 0.0.0.0 --http-localhost-fallback)

# --- Helpers ---------------------------------------------------------------
c_info()  { printf '\033[36m[dev-switch]\033[0m %s\n' "$*"; }
c_ok()    { printf '\033[32m[dev-switch]\033[0m %s\n' "$*"; }
c_warn()  { printf '\033[33m[dev-switch]\033[0m %s\n' "$*"; }
c_err()   { printf '\033[31m[dev-switch]\033[0m %s\n' "$*" >&2; }

require_pkg_dir() {
  if [[ ! -d "${PKG_DIR}" ]]; then
    c_err "Installed extension package not found at: ${PKG_DIR}"
    c_err "Is @wherever-dev/pi installed under ~/.pi/agent/npm? Aborting."
    exit 1
  fi
}

# True when the active dist is our local symlink.
is_dev_active() {
  [[ -L "${DIST}" ]]
}

stop_service() {
  if systemctl --user list-unit-files 2>/dev/null | grep -q "^${SERVICE}"; then
    if systemctl --user is-active --quiet "${SERVICE}"; then
      c_info "Stopping systemd service ${SERVICE}..."
      systemctl --user stop "${SERVICE}"
    else
      c_info "systemd service ${SERVICE} already stopped."
    fi
  else
    c_warn "systemd service ${SERVICE} not found; skipping stop."
  fi
}

start_service() {
  if systemctl --user list-unit-files 2>/dev/null | grep -q "^${SERVICE}"; then
    c_info "Starting systemd service ${SERVICE}..."
    systemctl --user start "${SERVICE}"
    systemctl --user is-active --quiet "${SERVICE}" \
      && c_ok "${SERVICE} is running." \
      || c_warn "${SERVICE} did not report active; check: systemctl --user status ${SERVICE}"
  else
    c_warn "systemd service ${SERVICE} not found; skipping start."
  fi
}

link_local_ext() {
  if [[ ! -d "${LOCAL_EXT_DIST}" ]]; then
    c_err "Local extension build not found at: ${LOCAL_EXT_DIST}"
    c_err "Run 'pnpm --filter ./extension build' first. Aborting."
    exit 1
  fi

  if is_dev_active; then
    local current
    current="$(readlink "${DIST}")"
    if [[ "${current}" == "${LOCAL_EXT_DIST}" ]]; then
      c_ok "Local extension already linked (${DIST} -> ${current})."
      return
    fi
    c_warn "dist is a symlink to ${current}; replacing with local build."
    rm "${DIST}"
  elif [[ -e "${DIST}" ]]; then
    # Real published dist: back it up (never overwrite an existing backup).
    if [[ -e "${DIST_BACKUP}" ]]; then
      c_err "Backup already exists at ${DIST_BACKUP} but dist is not a symlink."
      c_err "Refusing to clobber. Inspect ${PKG_DIR} manually. Aborting."
      exit 1
    fi
    c_info "Backing up published dist -> ${DIST_BACKUP}"
    mv "${DIST}" "${DIST_BACKUP}"
  fi

  ln -s "${LOCAL_EXT_DIST}" "${DIST}"
  c_ok "Linked local extension: ${DIST} -> ${LOCAL_EXT_DIST}"
}

restore_published_ext() {
  if is_dev_active; then
    c_info "Removing local extension symlink."
    rm "${DIST}"
    if [[ -e "${DIST_BACKUP}" ]]; then
      c_info "Restoring published dist from ${DIST_BACKUP}"
      mv "${DIST_BACKUP}" "${DIST}"
      c_ok "Published extension restored."
    else
      c_warn "No backup at ${DIST_BACKUP} to restore."
      c_warn "The published dist is gone; reinstall with:"
      c_warn "  (cd ~/.pi/agent/npm && pnpm install --force @wherever-dev/pi)"
    fi
  elif [[ -e "${DIST}" ]]; then
    c_ok "Already on the published extension (dist is a real directory)."
    [[ -e "${DIST_BACKUP}" ]] && c_warn "Stale backup present: ${DIST_BACKUP} (safe to remove)."
  else
    c_err "No dist and no symlink at ${DIST}. Extension install looks broken."
    exit 1
  fi
}

cmd_status() {
  require_pkg_dir
  c_info "Extension package: ${PKG_DIR}"
  if is_dev_active; then
    c_ok "ACTIVE: LOCAL dev build  (${DIST} -> $(readlink "${DIST}"))"
  elif [[ -e "${DIST}" ]]; then
    c_ok "ACTIVE: PUBLISHED build   (${DIST})"
  else
    c_err "ACTIVE: NONE (missing ${DIST})"
  fi
  [[ -e "${DIST_BACKUP}" ]] && c_info "Backup present: ${DIST_BACKUP}"

  # Does the currently-active dist contain the sudo handler? Handy sanity check.
  if grep -qs "cli_bash_sudo" "${DIST}/index.js" 2>/dev/null; then
    c_ok "Active extension HAS the cli_bash_sudo handler."
  else
    c_warn "Active extension does NOT have the cli_bash_sudo handler."
  fi

  if systemctl --user is-active --quiet "${SERVICE}" 2>/dev/null; then
    c_info "systemd ${SERVICE}: running"
  else
    c_info "systemd ${SERVICE}: stopped"
  fi
}

cmd_dev() {
  require_pkg_dir
  c_info "Switching to DEV mode."
  stop_service
  link_local_ext
  c_info "Building repo (pnpm build)..."
  ( cd "${REPO_ROOT}" && pnpm build )
  c_warn "Restart any live pi CLI-bridge session so it reloads the extension."
  c_info "Starting repo server in the foreground (Ctrl-C to stop):"
  c_info "  ${SERVER_DEV_CMD[*]}"
  cd "${REPO_ROOT}"
  exec "${SERVER_DEV_CMD[@]}"
}

cmd_normal() {
  require_pkg_dir
  c_info "Switching to NORMAL mode."
  restore_published_ext
  start_service
  c_warn "Restart any live pi CLI-bridge session so it reloads the published extension."
}

# --- Dispatch --------------------------------------------------------------
case "${1:-}" in
  dev)     cmd_dev ;;
  normal)  cmd_normal ;;
  status)  cmd_status ;;
  *)
    cat >&2 <<EOF
Usage: scripts/dev-switch.sh <dev|normal|status>

  dev     Link the LOCAL repo extension build, stop the systemd server,
          build the repo, and run the repo server in the foreground:
            ${SERVER_DEV_CMD[*]}
  normal  Restore the PUBLISHED extension and start the systemd service.
  status  Show which extension is active and whether the service is running.
EOF
    exit 2
    ;;
esac
