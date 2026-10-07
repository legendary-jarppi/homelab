# workout

Workout log for Jari and Elina at http://workout.lab.internal: distance per workout on the treadmill, cross trainer and rowing machine; this week, monthly and yearly charts, weekly summaries. Built for phones (add to the Home Screen); the iPad and desktop get side-by-side charts.

SvelteKit 2 + Svelte 5 (adapter-node) and Postgres 17, same layout as [apps/news](../news/).

## Pages

| Path | Content |
|---|---|
| `/` | Log form (person, machine, km, date; the device remembers the person, each person's last machine is preselected), this week per person with last week and year to date, latest entries |
| `/entries/<id>` | Edit or delete a workout |
| `/month/YYYY-MM` | Month totals, daily chart, the month's weeks, every workout of the month |
| `/year/YYYY` | Year totals and weekly average, monthly chart (tap a month to open it), weekly chart, weekly summary table (per machine, total, cumulative, average), all-years chart |

Month and year pages take `?p=jari` / `?p=elina`; without it they show both side by side on one scale.

Conventions: weeks are ISO 8601 (Monday start, week 1 contains the first Thursday), like the old sheet. Month and year totals use calendar dates; the year page's weekly table lists the ISO weeks of that ISO year, so the two can differ by the few days around New Year. "Today" is Europe/Helsinki (`TIME_ZONE`).

## Data

One table, `workouts` (`migrations/001_init.sql`): person, machine, day, meters (integer; the UI speaks km), `source` (NULL when logged in the app). People and machines are fixed lists in `src/lib/domain.ts` plus CHECK constraints; adding one means editing both (new migration).

### Import from the Google Sheet

`scripts/import-sheet.ts` reads the old sheet (tabs 2022-2026) and replaces every previously imported row (`source = 'sheet:<tab>!<cell>'`) in one transaction; workouts logged in the app are never touched. It refuses to write anything unless every week's parsed distances equal the sheet's own weekly total columns. Cell rules and tab layouts are documented at the top of the script. Not imported: the films, fitness test and personal records tabs, and the third person in 2023 (Ansku, 5 workouts, 35 km). Pre-2024 cells have no machine prefix and are imported as treadmill.

Imported 2026-10-04: 1136 workouts, 8697.57 km, 2022-09-08 to 2026-08-19.

Re-run (for example, if the sheet was still used after that date; app entries for the same days would then be duplicates). The sheet must be shared "Anyone with the link: Viewer":

```sh
cd apps/workout && npm install
kubectl -n workout port-forward svc/postgres 55433:5432 &
DATABASE_URL="postgres://workout:$(kubectl -n workout get secret workout-db -o jsonpath='{.data.POSTGRES_PASSWORD}' | base64 -d)@127.0.0.1:55433/workout" \
  npm run import-sheet -- --url '<sheet URL>'    # or --file book.xlsx; --dry-run only prints the summary
```

## Access

Passcode login like the dashboard: session cookie valid for a year (HttpOnly, HMAC-signed with `SESSION_SECRET`), five wrong passcodes lock an address out for 15 minutes. The passcode was initially copied from the dashboard's.

Secrets (not in git):

```sh
kubectl -n workout create secret generic workout-db --from-literal=POSTGRES_PASSWORD="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
kubectl -n workout create secret generic workout-auth --from-literal=PASSCODE=<passcode> \
  --from-literal=SESSION_SECRET="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"
```

Change the passcode (sessions stay valid):

```sh
read -rsp 'New passcode: ' P && echo
kubectl -n workout create secret generic workout-auth --from-literal=PASSCODE="$P" \
  --from-literal=SESSION_SECRET="$(kubectl -n workout get secret workout-auth -o jsonpath='{.data.SESSION_SECRET}' | base64 -d)" \
  --dry-run=client -o yaml | kubectl apply -f -
unset P
kubectl -n workout rollout restart deploy/web
```

`POSTGRES_PASSWORD` only takes effect when the database volume is first created.

## Dashboard card

The home dashboard's Workouts card shows this week per person (total, workouts, km per machine). The dashboard server calls `GET /api/summary` here over the cluster network (`http://web.workout.svc:3000`, allowed by the `web-from-dashboard` NetworkPolicy) with `Authorization: Bearer <token>`; the browser never sees the token. Response type: `WorkoutSummary` in `apps/dashboard/src/lib/types.ts`. Without a token configured the endpoint answers 404; through Traefik it is reachable only with the token too.

The token lives in two secrets with the same value (`workout-api`/`SUMMARY_TOKEN` here, `dashboard-workout`/`WORKOUT_TOKEN` in `dashboard`). Rotate:

```sh
T=$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')
kubectl -n workout create secret generic workout-api --from-literal=SUMMARY_TOKEN="$T" --dry-run=client -o yaml | kubectl apply -f -
kubectl -n dashboard create secret generic dashboard-workout --from-literal=WORKOUT_TOKEN="$T" --dry-run=client -o yaml | kubectl apply -f -
unset T
kubectl -n workout rollout restart deploy/web && kubectl -n dashboard rollout restart deploy/dashboard
```

## Develop

```sh
cd apps/workout
npm install
podman run -d --name workout-pg -e POSTGRES_USER=workout -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=workout -p 127.0.0.1:55432:5432 docker.io/library/postgres:17-alpine
DATABASE_URL=postgres://workout:dev@127.0.0.1:55432/workout PASSCODE=dev \
  SESSION_SECRET=$(python3 -c 'import secrets; print(secrets.token_hex(32))') npm run dev
npm run check   # svelte-check / TypeScript
```

Migrations (`migrations/NNN_*.sql`) are applied when the server starts.

## Deploy

```sh
./apps/workout/deploy.sh
```

Builds with podman, imports the image into k3s's containerd (`sudo k3s ctr`; no registry, `imagePullPolicy: Never`), writes the tag into `deploy/kustomization.yaml`, applies, and waits for the rollout. Commit the tag change. NetworkPolicy: `web` accepts only Traefik and the dashboard and talks only to Postgres; no internet egress.
