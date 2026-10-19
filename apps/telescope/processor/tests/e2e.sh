#!/usr/bin/env bash
# End to end on a synthetic archive, locally with podman (nothing deployed, nothing in the cluster):
#   ./apps/telescope/processor/tests/e2e.sh [work dir]      (default /tmp/telescope-processor-e2e)
# Builds the image, writes the synthetic archive once (~1.6 GB, synthetic.py; needs no network),
# runs the fake telescope service and the processor in one pod (archive mounted read only, memory
# limit and read-only root as in the cluster), waits for the automatic final, then runs check.py
# (library, match warnings, finals, calibration quality, stars, the viewer's image, plate solve and
# star measurement, publishing, the tar); then recreates the processor (FINALS_KEEP=1) and checks
# that title and publish survived, a third final, and every older version kept. Photometric colour
# calibration queries VizieR (internet); without it the fallback white balance is used and the
# colour check fails. Keeps the pod's output in <work dir>/processed for a look; removes the pod.
set -euo pipefail

here=$(cd "$(dirname "$0")/.." && pwd)
work=${1:-/tmp/telescope-processor-e2e}
image=localhost/telescope-processor:e2e
pod=telescope-processor-e2e
memory=${MEMORY:-4g}

podman build -q -t "$image" -f "$here/Containerfile" "$here" >/dev/null
mkdir -p "$work"
if [ ! -f "$work/sessions.json" ]; then
  rm -rf "$work/archive" && mkdir -p "$work/archive"
  podman run --rm --userns=keep-id --user "$(id -u):$(id -g)" -v "$here/tests:/tests:ro,Z" -v "$work:/out:Z" \
    "$image" python /tests/synthetic.py /out/archive /out/sessions.json
fi
rm -rf "$work/processed" && mkdir -p "$work/processed"
podman pod rm -f "$pod" >/dev/null 2>&1 || true
trap 'podman pod rm -f "$pod" >/dev/null 2>&1 || true' EXIT
podman pod create --name "$pod" --userns=keep-id >/dev/null
podman run -d --pod "$pod" --name "$pod-service" --user "$(id -u):$(id -g)" -v "$here/tests:/tests:ro,Z" \
  -v "$work:/syn:ro,Z" "$image" python /tests/fake_service.py /syn/sessions.json 8081 >/dev/null
# The processor as in the cluster (FINALS_KEEP and the like added by the second phase).
processor() {
  podman run -d --pod "$pod" --name "$pod-processor" --user "$(id -u):$(id -g)" --memory="$memory" --read-only \
    --tmpfs /tmp:rw,size=2g -e TELESCOPE_URL=http://localhost:8081 -e SETTLE_MIN=0 -e AUTO_HOURS=0-24 \
    -e SIRIL_MEM_GB="${SIRIL_MEM_GB:-2}" "$@" -v "$work/archive:/archive:ro,Z" -v "$work/processed:/processed:Z" \
    -v "$here/tests:/tests:ro,Z" -v "$work:/syn:ro,Z" "$image" >/dev/null
  for _ in $(seq 300); do
    podman exec "$pod-processor" python -c "import urllib.request as u; u.urlopen('http://localhost:8080/healthz')" \
      2>/dev/null && return
    sleep 1
  done
  echo "processor did not start" >&2 && exit 1
}
started=$(date +%s)
processor
# Test only: Pillow (pinned) to decode the viewer's full.jpg, in the container's tmpfs; not in the image.
podman exec "$pod-processor" pip install -q --no-cache-dir --only-binary=:all: --target /tmp/pil pillow==13.0.0
status=0
podman exec "$pod-processor" python /tests/check.py /syn/sessions.json || status=$?
echo "wall time $(( $(date +%s) - started )) s; container memory peak (page cache included):" \
  "$(podman exec "$pod-processor" cat /sys/fs/cgroup/memory.peak 2>/dev/null | awk '{printf "%.0f MB", $1/1048576}')"
podman logs "$pod-processor" >"$work/processor.log" 2>&1
# Second phase: a new processor container on the same volume (a restart, with FINALS_KEEP=1): the
# gallery fields persisted, a third final, every version kept (the older unpublished one slimmed).
podman rm -f "$pod-processor" >/dev/null
processor -e FINALS_KEEP=1
podman exec "$pod-processor" python /tests/check.py /syn/sessions.json restart || status=$?
podman logs "$pod-processor" >>"$work/processor.log" 2>&1
exit $status
