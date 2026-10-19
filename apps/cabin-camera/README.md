# cabin-camera

Motion pictures and video clips from the camera at the cabin (Reolink Go Plus, 4G, battery) on the dashboard's *Cabin 4G camera* card (*Cameras* tab). The camera has no RTSP/ONVIF (Reolink: not supported on 4G models) and is not on any of our networks, so on each motion event it uploads a picture and then the clip over **FTPS**, through the internet to the home's public address.

```
camera (4G) ──FTPS──▶ UDM Pro port forward ──▶ 192.168.1.10 (ServiceLB) ──▶ SFTPGo ──▶ volume ──▶ snapshot service ──▶ dashboard
```

One pod, two containers sharing PVC `snapshots` (20 Gi requested, not enforced by local-path; backed up nightly):

| Container | |
|---|---|
| `ftp` | SFTPGo 2.7.6 (distroless). FTPS only (`tls_mode` 1: TLS required on control and data connections, TLS 1.2+, self-signed certificate); SFTP, web UI, REST API, WebDAV off. Control port 2121, passive data ports 50000-50009, no active mode. One account, `cabin`, upload-only (list, upload, create folders, overwrite; no download, delete, rename), 4 sessions, 200 MB per file, 20 GB quota. Atomic uploads: files are written under `.uploading` (outside the listed folder; an init container creates it) and moved in when complete, so a clip still uploading over 4G is never shown half-written; failed uploads are deleted. The defender bans an address for an hour after about 8 failed logins (longer on repeat); failed logins wait 1 s |
| `snapshots` | Node 22, no dependencies (`src/main.ts`). Lists and serves pictures (`.jpg`, `.jpeg`, `.png`) and clips (`.mp4`; anything else is never served) to the dashboard, newest first by upload time, with HTTP Range requests (Safari plays video only through them); deletes files older than `RETENTION_DAYS` (30) hourly. Cluster-internal: `GET /api/snapshots?limit=N`, `GET /snapshots/<path>` |

The dashboard groups each clip with the picture uploaded up to 10 minutes before it into one motion event (`apps/dashboard/src/lib/cabin.ts`).

NetworkPolicy: FTPS ports from anywhere (the camera's 4G address changes), the snapshot service from the dashboard only, nothing outbound. firewalld opens 2121 and 50000-50009 (`platform/host/prepare.sh`).

## Setup

1. Secret (camera account and certificate; kept on re-runs, `--rotate` for a new password) and deploy:
   ```sh
   ./apps/cabin-camera/setup.sh
   ./apps/cabin-camera/deploy.sh
   kubectl -n cabin-camera get secret cabin-ftp -o jsonpath='{.data.password}' | base64 -d   # camera password
   ```
2. **UDM Pro port forwarding** (UniFi Network → *Settings → Routing → Port Forwarding → Create Entry*), two entries, both TCP, from *Any*, to `192.168.1.10`:

   | Name | WAN port | Forward port |
   |---|---|---|
   | Cabin camera FTPS | `2121` | `2121` |
   | Cabin camera FTPS data | `50000-50009` | `50000-50009` |

3. **Camera** (Reolink app → camera → *Settings → FTP*):
   - Server: the home's public address (`88.112.205.238` now; see below), port `2121`
   - Username `cabin`, password from step 1
   - *Älä salli salaamatonta FTP:tä* (don't allow unencrypted FTP): on
   - Upload: pictures and video (clips use far more mobile data and backup space than pictures)
   - Remote directory: empty (the camera's date folders are fine); then *Test* and enable FTP upload on motion
4. Check: `kubectl -n cabin-camera logs deploy/cabin-camera -c ftp` shows the login and upload; the *Cabin 4G camera* card shows the picture within a minute.

The camera does not verify the certificate; it only encrypts. If it fails the TLS handshake (the log says so), its TLS may be older than 1.2: add `SFTPGO_FTPD__BINDINGS__0__MIN_TLS_VERSION=10` to the ConfigMap in `deploy/kustomization.yaml`.

SFTPGo logs only logins and transfers at `info`; connections that fail earlier (TLS handshake, plain FTP, wrong port) appear only at `debug`, which is on (`SFTPGO_LOG_LEVEL`) until the camera uploads reliably. Each attempt shows as `Client connected` with the camera operator's public address.

### Public address

Passive transfers tell the camera to connect back to `SFTPGO_FTPD__BINDINGS__0__FORCE_PASSIVE_IP`, and the camera itself is configured with the address. Both are the home's current public address (the UDM Pro's WAN address, `88.112.205.238`). If the ISP changes it, uploads stop: update both, or set up a dynamic DNS name (UniFi: *Settings → Internet → WAN → Dynamic DNS*), use it on the camera, and replace `FORCE_PASSIVE_IP` with `SFTPGO_FTPD__BINDINGS__0__PASSIVE_HOST=<name>`.

Clients on the LAN (and this node itself) get the node's address for passive transfers instead (`PASSIVE_IP_OVERRIDES`), so uploads can be tested without the port forward:

```sh
P=$(kubectl -n cabin-camera get secret cabin-ftp -o jsonpath='{.data.password}' | base64 -d)
curl --ssl-reqd -k --ftp-create-dirs --user "cabin:$P" -T picture.jpg ftp://192.168.1.10:2121/test/picture.jpg
kubectl -n cabin-camera exec deploy/cabin-camera -c snapshots -- rm -r /data/cabin/test   # the account cannot delete
```

## Operating

| Task | |
|---|---|
| Logins, uploads, bans | `kubectl -n cabin-camera logs deploy/cabin-camera -c ftp` (JSON; `"event":"banned"` for bans) |
| Clear bans | Restart the pod (`kubectl -n cabin-camera rollout restart deploy/cabin-camera`); the defender keeps them in memory |
| New camera password | `./apps/cabin-camera/setup.sh --rotate`, then enter it in the Reolink app |
| Retention | `RETENTION_DAYS` in `deploy/app.yaml`; quota and per-file limit in `setup.sh` (re-run it after changing) |
| Space used | `kubectl -n cabin-camera exec deploy/cabin-camera -c snapshots -- du -sh /data/cabin` |

The port forward is the homelab's only service reachable from the internet. To take it offline, disable the two UDM Pro entries (or scale the deployment to 0).
