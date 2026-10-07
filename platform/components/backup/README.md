# backup

Nightly encrypted backup of the cluster's data to Google Drive: a CronJob (03:30 Europe/Helsinki) running [restic](https://restic.net) 0.18 with the repository on Drive through rclone (`rclone:gdrive:homelab-backup`, folder `homelab-backup` in My Drive). If the machine is off at 03:30, the run starts when it is back (up to 12 h late).

| What | How |
|---|---|
| Postgres databases | `pg_dump` (custom format) inside every pod labelled `backup.homelab/dump: postgres`; their raw data volumes are not copied (a live copy is not consistent). Today: `news`, `workout` |
| Files | Every local-path volume in `/var/lib/rancher/k3s/storage`, new ones included automatically (read-only hostPath). Today: news images, dashboard packages, Grafana |
| Secrets | Opaque secrets of all namespaces without an owner (`secrets.json`, a `kubectl apply`-able List); they are not in git |
| Left out | `EXCLUDE` in `kustomization.yaml` (`<namespace>/<pvc>`): Prometheus (15 days of metrics, rebuilt by scraping) |

Restic encrypts everything before upload (Google sees only random-named blobs), stores unchanged data once, and keeps 7 daily, 5 weekly and 12 monthly snapshots. On Sundays the run also downloads and verifies 10% of the data (`restic check --read-data-subset 10%`).

rclone uses the `drive.file` scope: the token can only see files rclone itself created, not the rest of the Drive.

**Without the restic password the backup cannot be read, by anyone.** Keep it in a password manager, not only on this machine.

## Adding an app

| App keeps data in | Do |
|---|---|
| A PVC (files, SQLite) | Nothing; backed up automatically. SQLite: a copy of a database being written can be torn; fine for rarely written files, otherwise dump it to a file on the volume first |
| Postgres (official image, `POSTGRES_USER`/`POSTGRES_DB` env) | Label the pod template `backup.homelab/dump: postgres`, like `apps/*/deploy/postgres.yaml` |
| Disposable data | Add `<namespace>/<pvc>` to `EXCLUDE` |

## Setup

1. Google Drive access. Run on this machine and open the printed `http://127.0.0.1:53682/auth?...` link in a browser here (from another computer: `ssh -L 53682:127.0.0.1:53682 shilly-shally-lab-01` first, then open the link there). Log in with the Google account whose Drive gets the backups and allow access:
   ```sh
   mkdir -m 700 -p ~/rclone-gdrive
   podman run --rm -it --network host -v ~/rclone-gdrive:/config/rclone:Z docker.io/rclone/rclone:1.74 \
     config create gdrive drive scope=drive.file
   ```
2. Repository password (generated; **save the printed value in your password manager now**) and the secret:
   ```sh
   P=$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))'); echo "restic password: $P"
   kubectl -n backup create secret generic backup --from-literal=RESTIC_PASSWORD="$P" \
     --from-file=rclone.conf="$HOME/rclone-gdrive/rclone.conf" --dry-run=client -o yaml | kubectl apply -f -
   unset P; rm -r ~/rclone-gdrive
   ```
3. `./platform/components/backup/deploy.sh` (image + CronJob), then a first run (below). It creates the repository.

Google Drive access lasts until revoked (Google account → *Security* → *Third-party apps*: "rclone"); a new authorization is step 1 again plus re-creating the secret with the same password.

## Operating

The dashboard shows the status as a pill in its top bar ("Backup ok", amber "Backup failed" / "No backup" / "Backup late" when the newest run failed, none succeeded yet, or the last success is older than 26 h) and in detail on the Homelab tab's card; the night screen's status dot turns too.

Occasional `rateLimitExceeded` / `403 Quota exceeded` lines from rclone in the log are Google throttling rclone's shared client ID; restic retries them and the run still succeeds. If runs start failing on it, create your own Google OAuth client (rclone docs: *Making your own client_id*), publish it to *In production* (a *Testing* app's tokens expire after 7 days) and redo *Setup* step 1 with `client_id=… client_secret=…` added.

```sh
kubectl -n backup create job --from=cronjob/backup backup-$(date +%s)   # run now
kubectl -n backup get jobs                                               # last runs (3 kept of each outcome)
kubectl -n backup logs job/<name>
```

Browse or restore with restic: a copy of the CronJob's pod that sleeps, so it has the same credentials and mounts:

```sh
kubectl -n backup create job restic-shell --from=cronjob/backup --dry-run=client -o json \
  | jq '.spec.template.spec.containers[0].command = ["sleep", "3600"]' | kubectl apply -f -
kubectl -n backup wait --for=condition=ready pod -l job-name=restic-shell
kubectl -n backup exec -it job/restic-shell -- sh -c 'cp /etc/rclone/rclone.conf /work/ && RCLONE_CONFIG=/work/rclone.conf sh'
#   restic snapshots; restic ls latest /storage; restic dump latest <file> > /work/x
#   restic restore latest --target /work/r --include /work/stage    # dumps and secrets
kubectl -n backup delete job restic-shell
```

The pod cannot change file owners, so restore volume contents where you run as root (below).

Paths inside a snapshot: `/work/stage/postgres/<namespace>_<pod>.dump`, `/work/stage/secrets/secrets.json`, `/storage/pvc-<uid>_<namespace>_<pvc>/`.

## Restoring after losing the machine

Needs the restic password, and this repo on GitHub (push it; local-only commits go down with the machine).

1. Rebuild the host and cluster from this repo ([platform/README.md](../../README.md#bootstrap)), skipping the secret-creation steps.
2. Install restic and rclone (`sudo dnf install restic rclone`, EPEL), authorize rclone as in *Setup* step 1 (same Google account; `drive.file` access is per app, so a new token sees the old folder), then, as root so file owners are kept:
   ```sh
   sudo -i    # restic as root keeps file owners; the rest of this list runs in that shell
   export RCLONE_CONFIG=/home/jari/rclone-gdrive/rclone.conf RESTIC_REPOSITORY=rclone:gdrive:homelab-backup
   read -rsp 'restic password: ' RESTIC_PASSWORD && export RESTIC_PASSWORD && echo
   restic snapshots
   restic restore latest --target /root/restore
   ```
3. Secrets: `kubectl apply -f /root/restore/work/stage/secrets/secrets.json` (or pick single items with `jq`). Then deploy the apps as their READMEs describe.
4. Postgres, per app, into the freshly created empty database (same user and database names as before):
   ```sh
   kubectl -n workout exec -i postgres-0 -- pg_restore -U workout -d workout --clean --if-exists --no-owner \
     < /root/restore/work/stage/postgres/workout_postgres-0.dump
   ```
5. Files: scale the app to 0, copy the old volume's contents into the new volume directory with owners kept (`cp -a /root/restore/storage/pvc-<old uid>_<namespace>_<pvc>/. /var/lib/rancher/k3s/storage/pvc-<new uid>_<namespace>_<pvc>/`), scale back up.
