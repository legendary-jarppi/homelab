#!/usr/bin/env bash
# Build the homelab image, load it into k3s's containerd (no registry), and roll it out.
#   ./apps/homelab/deploy.sh
# Needs podman, git, kubectl access, and root for `k3s ctr` (sudo; override with K3S_CTR).
# Records the new tag in deploy/kustomization.yaml; commit that change.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
tag=$(date +%Y%m%d-%H%M%S)
image=localhost/homelab:$tag
ctr=${K3S_CTR:-sudo /usr/local/bin/k3s ctr}

# Build context: the repository's layout with only what the build needs (not every app's
# node_modules): this app, and every markdown file git tracks, which the site bundles.
ctx=$(mktemp -d)
trap 'rm -rf "$ctx"' EXIT
tar -C "$repo" --exclude=apps/homelab/node_modules --exclude=apps/homelab/build \
  --exclude=apps/homelab/.svelte-kit --exclude=apps/homelab/.env -cf - apps/homelab | tar -C "$ctx" -xf -
git -C "$repo" ls-files -z -- '*.md' | tar -C "$repo" --null -T - -cf - | tar -C "$ctx" -xf -

podman build -t "$image" -f "$ctx/apps/homelab/Containerfile" "$ctx"
podman save "$image" | $ctr images import -
podman rmi "$image" >/dev/null

sed -i -E "s/^(\s*newTag:).*/\1 \"$tag\"/" "$here/deploy/kustomization.yaml"
kubectl apply -k "$here/deploy"
kubectl -n homelab rollout status deploy/homelab --timeout=180s
echo "deployed $image"
