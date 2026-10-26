# Linux E2E runner

Run `npm run test:e2e:linux` to reproduce CI's Linux rendering in Docker on a Mac.
Start Docker Desktop or Colima first. Pass Playwright arguments after `--`, for
example `npm run test:e2e:linux -- e2e/visual-integrity.spec.ts`.

Before building, the runner checks free space on the daemon's data disk using
`docker info --format '{{.DockerRootDir}}'` and `docker run --rm alpine df -Pk /`.
The container root overlay reflects that disk inside Colima or Docker Desktop;
the daemon's data root is never mounted. The small Alpine image may be pulled
for this probe. If measurement fails, the runner warns and continues.

The runner exits with status 1 if free space is below 1024 MB by default. A run
writes its container layer, traces and reports to that disk; on 2026-10-26 a
run with about 350 MB free failed with ENOSPC partway through. Override
the threshold with a non-negative integer in MB:

```sh
NEXT168_E2E_LINUX_MIN_FREE_MB=3072 npm run test:e2e:linux
```

To inspect potentially stale runner volumes, use:

```sh
docker volume ls --filter name=next168-e2e-linux
```

Each checkout path has its own volume set, named with the first ten hex digits
of its path's SHA-1 hash (`printf '%s' "$checkout_path" | shasum | cut -c1-10`).
The low-space message prints the current checkout's slot hash. Remove only
volumes belonging to checkouts that no longer exist; other projects share the
daemon. You can also increase the Docker VM's disk capacity or free space on its
data disk. Reports and traces are copied back to `e2e/.results` and `e2e/.report`.
