#!/usr/bin/env bash
set -euo pipefail

echo "[start] Configuring SSH for ${SSH_USER:-root}"

USER_NAME="${SSH_USER:-root}"
USER_HOME=$(getent passwd "$USER_NAME" | cut -d: -f6)
if [[ -z "$USER_HOME" ]]; then
  echo "[start] ERROR: User $USER_NAME not found"
  exit 1
fi

mkdir -p "$USER_HOME/.ssh"
touch "$USER_HOME/.ssh/authorized_keys"
chmod 700 "$USER_HOME/.ssh"
chmod 600 "$USER_HOME/.ssh/authorized_keys"
chown -R "$USER_NAME:$USER_NAME" "$USER_HOME/.ssh"

if [[ -n "${SSH_PUBLIC_KEY:-}" ]]; then
  if ! grep -qxF "$SSH_PUBLIC_KEY" "$USER_HOME/.ssh/authorized_keys"; then
    echo "$SSH_PUBLIC_KEY" >> "$USER_HOME/.ssh/authorized_keys"
    echo "[start] Added SSH public key for $USER_NAME"
  else
    echo "[start] SSH public key already present"
  fi
else
  echo "[start] WARNING: SSH_PUBLIC_KEY env not provided; key-only login may fail."
fi

# Ensure output and input dirs exist
mkdir -p /output/adapter /workspace/input

# Generate SSH host keys if they don't exist
if [ ! -f /etc/ssh/ssh_host_rsa_key ]; then
  echo "[start] Generating SSH host keys..."
  ssh-keygen -A
fi

echo "[start] Starting sshd..."
exec /usr/sbin/sshd -D -e

