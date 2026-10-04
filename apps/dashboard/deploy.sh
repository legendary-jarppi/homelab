#!/usr/bin/env bash
# Build the dashboard image, load it into k3s's containerd (no registry), and roll it out.
#   ./apps/dashboard/deploy.sh
# Needs podman, kubectl access, and root for `k3s ctr` (sudo; override with K3S_CTR).
# Records the new tag in deploy/kustomization.yaml; commit that change.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
tag=$(date +%Y%m%d-%H%M%S)
image=localhost/home-dashboard:$tag
ctr=${K3S_CTR:-sudo /usr/local/bin/k3s ctr}

podman build -t "$image" -f "$here/Containerfile" "$here"
podman save "$image" | $ctr images import -
podman rmi "$image" >/dev/null

sed -i -E "s/^(\s*newTag:).*/\1 \"$tag\"/" "$here/deploy/kustomization.yaml"
kubectl apply -k "$here/deploy"
kubectl -n dashboard rollout status deploy/dashboard --timeout=180s
echo "deployed $image"
