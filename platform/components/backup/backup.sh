#!/bin/sh
# One backup run into the restic repository $RESTIC_REPOSITORY (see README.md):
#   1. pg_dump of every pod labelled backup.homelab/dump=postgres, run inside that pod (matching
#      client version, local trust auth); the raw data volumes of those pods are left out
#   2. the Opaque secrets of all namespaces (they are not in git)
#   3. every local-path volume under /storage, except the above and $EXCLUDE (<namespace>/<pvc> ...)
# then retention, and on Sundays a check that downloads and verifies a sample of the data.
set -euo pipefail

work=/work
stage=$work/stage
export TMPDIR=$work/tmp RESTIC_CACHE_DIR=$work/cache RCLONE_CONFIG=$work/rclone.conf
mkdir -p "$TMPDIR" "$stage/postgres" "$stage/secrets"
# rclone writes refreshed access tokens back to its config; the mounted secret is read-only.
cp /etc/rclone/rclone.conf "$RCLONE_CONFIG"

log() { echo "$(date '+%F %T') $*"; }

# Exit code 10: no repository there yet. Any other failure (network, password) stops the run.
rc=0
restic cat config >/dev/null 2>&1 || rc=$?
if [ "$rc" = 10 ]; then
	log "creating repository $RESTIC_REPOSITORY"
	restic init
elif [ "$rc" != 0 ]; then
	restic cat config >/dev/null
fi
# Locks left by a killed run.
restic unlock

skip=$work/skip-volumes
for v in $EXCLUDE; do echo "$v"; done >"$skip"

kubectl get pods -A -l backup.homelab/dump=postgres -o jsonpath='{range .items[*]}{.metadata.namespace} {.metadata.name} {.spec.volumes[*].persistentVolumeClaim.claimName}{"\n"}{end}' >"$work/postgres-pods"
while read -r ns pod claims; do
	out=$stage/postgres/${ns}_$pod.dump
	log "pg_dump $ns/$pod"
	# Custom format (pg_restore), uncompressed so unchanged rows deduplicate; restic compresses.
	kubectl -n "$ns" exec "$pod" -- sh -c 'pg_dump -U "$POSTGRES_USER" -d "${POSTGRES_DB:-$POSTGRES_USER}" -Fc -Z0' </dev/null >"$out.tmp"
	[ "$(head -c 5 "$out.tmp")" = PGDMP ] || { log "$ns/$pod: not a pg_dump archive"; exit 1; }
	mv "$out.tmp" "$out"
	for c in $claims; do echo "$ns/$c"; done >>"$skip"
done <"$work/postgres-pods"

log "exporting secrets"
kubectl get secrets -A -o json | jq '{apiVersion: "v1", kind: "List", items: [.items[]
	| select(.type == "Opaque" and (.metadata.ownerReferences | not))
	| {apiVersion, kind, type, data, metadata: ({name: .metadata.name, namespace: .metadata.namespace, labels: .metadata.labels}
		| with_entries(select(.value != null)))}]}' >"$stage/secrets/secrets.json"

# local-path names volume directories pvc-<uid>_<namespace>_<pvc>; Kubernetes names have no "_".
excludes=$work/excludes
: >"$excludes"
for d in /storage/*/; do
	d=${d%/}
	rest=${d##*/}
	rest=${rest#*_}
	if grep -qxF "${rest%%_*}/${rest#*_}" "$skip"; then
		log "skipping volume ${rest%%_*}/${rest#*_}"
		echo "$d" >>"$excludes"
	fi
done

log "backing up"
restic backup --host "$BACKUP_HOST" --exclude-file "$excludes" "$stage" /storage

log "applying retention"
restic forget --host "$BACKUP_HOST" --group-by host --keep-daily 7 --keep-weekly 5 --keep-monthly 12 --prune

if [ "$(date +%u)" = 7 ]; then
	log "checking repository, reading back 10% of the data"
	restic check --read-data-subset 10%
fi
log "done"
