#!/usr/bin/env bash
# Secret cabin-ftp for the cabin camera's FTPS server (SFTPGo), not in git:
#   users.json        the camera's upload-only account (SFTPGo memory provider)
#   password          the same password, to type into the Reolink app
#   tls.crt, tls.key  self-signed certificate (10 years); the camera does not check it, it only encrypts
# Existing password and certificate are kept; --rotate makes a new password (enter it on the camera).
#   ./apps/cabin-camera/setup.sh [--rotate]
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
ns=cabin-camera
kubectl apply -f "$here/deploy/namespace.yaml" >/dev/null

existing() { kubectl -n $ns get secret cabin-ftp -o jsonpath="{.data.$1}" 2>/dev/null | base64 -d || true; }
password=$(existing password)
[[ -z $password || ${1:-} == --rotate ]] && password=$(python3 -c 'import secrets; print(secrets.token_urlsafe(24))')

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
existing 'tls\.crt' >"$work/tls.crt"
existing 'tls\.key' >"$work/tls.key"
if [[ ! -s $work/tls.crt || ! -s $work/tls.key ]]; then
	openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 3650 \
		-subj '/CN=cabin-camera' -keyout "$work/tls.key" -out "$work/tls.crt" 2>/dev/null
fi

# Upload-only: list, upload, make the camera's date folders, overwrite; no download, delete or rename.
# Limits bound what a leaked password could do: 4 sessions, 200 MB per file (video clips), 20 GB in total.
PASSWORD=$password jq -n '{
	version: 16,
	users: [{
		username: "cabin",
		password: env.PASSWORD,
		status: 1,
		home_dir: "/srv/sftpgo/data/cabin",
		permissions: { "/": ["list", "upload", "create_dirs", "overwrite"] },
		max_sessions: 4,
		quota_size: 21474836480,
		filters: { max_upload_file_size: 209715200 }
	}]
}' >"$work/users.json"

kubectl -n $ns create secret generic cabin-ftp --from-literal=password="$password" \
	--from-file=users.json="$work/users.json" --from-file=tls.crt="$work/tls.crt" --from-file=tls.key="$work/tls.key" \
	--dry-run=client -o yaml | kubectl apply -f - >/dev/null
# SFTPGo reads users and certificate at start.
kubectl -n $ns rollout restart deploy/cabin-camera 2>/dev/null || true
echo "secret cabin-ftp written. Camera login: cabin / \$(kubectl -n $ns get secret cabin-ftp -o jsonpath='{.data.password}' | base64 -d)"
