#!/usr/bin/env bash
# Runs `playwright test` inside the official Playwright image that matches the locked
# @playwright/test version, so Linux-only font and layout differences reproduce on a Mac
# before pushing. Arguments are passed to `playwright test`.
#
# The working tree (tracked and untracked, minus ignored files) is copied into a fresh container,
# so no Docker file sharing is needed and the host's macOS node_modules and build are never touched.
# node_modules (root and companion, as in CI) and dist live in Docker volumes (one pair per checkout path) to keep reruns fast.
# Reports and traces come back to e2e/.results and e2e/.report.
# A daemon-disk preflight requires NEXT168_E2E_LINUX_MIN_FREE_MB (default 1024) before building.
#   NEXT168_E2E_LINUX_PLATFORM=linux/amd64 matches CI's CPU architecture (slow under emulation).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
pre_fence_commit="$(sed -nE "s/^export const PRE_FENCE_COMMIT = '([0-9a-f]{40})'$/\1/p" config/preFence.ts)"
if [[ ! "$pre_fence_commit" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Cannot read PRE_FENCE_COMMIT (expected one 40-hex constant) from config/preFence.ts" >&2
  exit 1
fi
if ! git cat-file -e "${pre_fence_commit}^{commit}" 2>/dev/null; then
  git fetch --quiet --depth=1 origin "$pre_fence_commit"
fi
version="$(node -p "require('./package-lock.json').packages['node_modules/@playwright/test'].version")"
base_image="mcr.microsoft.com/playwright:v${version}-noble"
image="next168-e2e-linux:v${version}"
slot="$(printf '%s' "$root" | shasum | cut -c1-10)"

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not reachable. Start the VM first: colima start --cpu 4 --memory 6" >&2
  exit 1
fi

min_free_mb="${NEXT168_E2E_LINUX_MIN_FREE_MB:-1024}"
if [[ ! "$min_free_mb" =~ ^[0-9]+$ ]]; then
  echo "NEXT168_E2E_LINUX_MIN_FREE_MB must be a non-negative integer (MB)." >&2
  exit 1
fi
# The container overlay uses the daemon's data disk, including inside Colima/Desktop VMs.
if docker_root="$(docker info --format '{{.DockerRootDir}}' 2>/dev/null)" \
  && [[ -n "$docker_root" ]] \
  && free_kb="$(docker run --rm alpine df -Pk / 2>/dev/null | awk '$6 == "/" && $4 ~ /^[0-9]+$/ {print $4}')" \
  && [[ "$free_kb" =~ ^[0-9]+$ ]]; then
  free_mb=$((free_kb / 1024))
  if (( free_mb < 10#$min_free_mb )); then
    echo "Docker data disk ($docker_root) has ${free_mb} MB free; at least ${min_free_mb} MB is required for Linux E2E." >&2
    echo "Find stale per-checkout volumes: docker volume ls --filter name=next168-e2e-linux" >&2
    echo "Volumes use a checkout-path slot hash (this checkout: $slot). Remove only volumes belonging to checkouts that no longer exist." >&2
    echo "Alternatively, increase the Docker VM's disk capacity or free space on its data disk." >&2
    exit 1
  fi
else
  echo "Warning: could not measure free space on Docker's data disk; continuing without the Linux E2E disk preflight." >&2
fi

platform_args=()
if [[ -n "${NEXT168_E2E_LINUX_PLATFORM:-}" ]]; then platform_args=(--platform "$NEXT168_E2E_LINUX_PLATFORM"); fi

# GitHub's ubuntu runners ship DejaVu (what "Verdana, DejaVu Sans, sans-serif" resolves to there); the
# Playwright image does not, so it would fall back to WenQuanYi and lay text out differently.
docker build --quiet "${platform_args[@]}" -t "$image" - >/dev/null <<DOCKERFILE
FROM $base_image
RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
DOCKERFILE

container="$(docker create --init --ipc=host "${platform_args[@]}" \
  -e CI=true \
  -e NEXT168_PRE_FENCE_SOURCE=/work/.pre-fence-source \
  -v "next168-e2e-linux-node-modules-$slot:/work/node_modules" \
  -v "next168-e2e-linux-companion-node-modules-$slot:/work/companion/node_modules" \
  -v "next168-e2e-linux-dist-$slot:/work/dist" \
  -w /work \
  "$image" \
  bash -c '
    set -euo pipefail
    install() { # <prefix>: npm ci into its volume-backed node_modules unless the lockfile is unchanged
      lock="$(sha256sum "$1/package-lock.json" | cut -d" " -f1)"
      if [ "$(cat "$1/node_modules/.linux-lock" 2>/dev/null || true)" != "$lock" ]; then
        find "$1/node_modules" -mindepth 1 -delete
        npm --prefix "$1" ci --no-audit --no-fund
        echo "$lock" > "$1/node_modules/.linux-lock"
      fi
    }
    install .
    install companion
    npx playwright test "$@"
  ' -- "$@")"
pre_fence_marker=''
trap '
  docker rm -f -v "$container" >/dev/null 2>&1 || true
  if [[ -n "$pre_fence_marker" ]]; then rm -f "$pre_fence_marker"; fi
' EXIT

# Files deleted in the working tree but still tracked are skipped.
git ls-files -z --cached --others --exclude-standard --deduplicate \
  | while IFS= read -r -d '' file; do if [[ -e "$file" ]]; then printf '%s\0' "$file"; fi; done \
  | COPYFILE_DISABLE=1 tar --no-xattrs --null -T - -cf - \
  | docker cp - "$container:/work"

git archive --format=tar --prefix=.pre-fence-source/ "$pre_fence_commit" \
  | docker cp - "$container:/work"
pre_fence_marker="$(mktemp)"
printf '%s\n' "$pre_fence_commit" > "$pre_fence_marker"
docker cp "$pre_fence_marker" "$container:/work/.pre-fence-source/.commit"

status=0
docker start -a "$container" || status=$?

mkdir -p e2e
for output in .results .report; do
  rm -rf "e2e/$output"
  docker cp "$container:/work/e2e/$output" "e2e/$output" >/dev/null 2>&1 || true
done
exit "$status"
