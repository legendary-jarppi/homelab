#!/usr/bin/env bash
# Toggle root access for the coding agent account.
#   sudo ./platform/host/agent-access.sh on      create account if missing, grant sudo
#   sudo ./platform/host/agent-access.sh off     revoke sudo, keep account
#   sudo ./platform/host/agent-access.sh remove  revoke sudo, delete account and its home
#        ./platform/host/agent-access.sh status
#
# While on, the invoking user (the session the agent runs in) may act as the agent
# account without a password, and that account has passwordless root. Root commands
# then run as `sudo -n -u omp sudo -n <cmd>`; audit with `journalctl _COMM=sudo`.
set -euo pipefail

AGENT_USER=omp
SUDOERS_FILE=/etc/sudoers.d/$AGENT_USER

usage() { echo "usage: $0 on|off|remove|status" >&2; exit 2; }

need_root() {
  [[ $EUID -eq 0 ]] || { echo "run as root: sudo $0 $1" >&2; exit 1; }
}

revoke() {
  if [[ -e $SUDOERS_FILE ]]; then
    rm -f "$SUDOERS_FILE"
    echo "revoked: removed $SUDOERS_FILE"
  else
    echo "already revoked"
  fi
}

cmd=${1:-}
case $cmd in
  on)
    need_root "$cmd"
    operator=${SUDO_USER:-}
    [[ -n $operator && $operator != root ]] || { echo "run via sudo from the user the agent runs as" >&2; exit 1; }
    if ! id "$AGENT_USER" &>/dev/null; then
      useradd --create-home --comment "omp coding agent" "$AGENT_USER"
      echo "created account $AGENT_USER (password locked)"
    fi
    tmp=$(mktemp)
    trap 'rm -f "$tmp"' EXIT
    cat > "$tmp" <<EOF
# Managed by homelab/platform/host/agent-access.sh; disable with: sudo $0 off
$operator ALL=($AGENT_USER) NOPASSWD: ALL
$AGENT_USER ALL=(ALL) NOPASSWD: ALL
EOF
    visudo -cqf "$tmp"
    install -m 0440 -o root -g root "$tmp" "$SUDOERS_FILE"
    visudo -cq
    echo "granted: $operator -> $AGENT_USER -> root"
    ;;
  off)
    need_root "$cmd"
    revoke
    ;;
  remove)
    need_root "$cmd"
    revoke
    if id "$AGENT_USER" &>/dev/null; then
      pkill -KILL -u "$AGENT_USER" || true
      userdel --remove "$AGENT_USER"
      echo "deleted account $AGENT_USER and its home"
    else
      echo "account $AGENT_USER does not exist"
    fi
    ;;
  status)
    if id "$AGENT_USER" &>/dev/null; then echo "account: present"; else echo "account: absent"; fi
    if [[ $EUID -eq 0 ]]; then
      [[ -e $SUDOERS_FILE ]] && echo "access: on" || echo "access: off"
    else
      sudo -n -u "$AGENT_USER" sudo -n true 2>/dev/null && echo "access: on" || echo "access: off"
    fi
    ;;
  *) usage ;;
esac
