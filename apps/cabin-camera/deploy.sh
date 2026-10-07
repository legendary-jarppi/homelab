#!/usr/bin/env bash
# Build the snapshot service image, load it into k3s's containerd (no registry), and roll out.
#   ./apps/cabin-camera/deploy.sh
# Needs podman, kubectl access, and root for `k3s ctr` (sudo; override with K3S_CTR); secret cabin-ftp
# from setup.sh. Records the new tag in deploy/kustomization.yaml; commit that change.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
tag=$(date +%Y%m%d-%H%M%S)
image=localhost/cabin-camera:$tag
ctr=${K3S_CTR:-sudo /usr/local/bin/k3s ctr}

podman build -t "$image" -f "$here/Containerfile" "$here"
podman save "$image" | $ctr images import -
podman rmi "$image" >/dev/null

sed -i -E "s/^(\s*newTag:).*/\1 \"$tag\"/" "$here/deploy/kustomization.yaml"
kubectl apply -k "$here/deploy"
kubectl -n cabin-camera rollout status deploy/cabin-camera --timeout=120s
echo "deployed $image"
