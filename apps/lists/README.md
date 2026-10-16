# lists

Lists of things done, watched or wanted at http://lists.lab.internal: watched movies (who watched, when, where), movies to watch, and any other list created in the app. Lists marked *Show on dashboard* appear on the home dashboard under the calendar. Built for phones (add to the Home Screen); same look as [apps/workout](../workout/).

SvelteKit 2 + Svelte 5 (adapter-node) and Postgres 17, same layout as apps/workout.

## Pages

| Path | Content |
|---|---|
| `/` | Every list with its item count and first three items; *New list* |
| `/lists/<slug>` | Quick add (title, then the list's fields; link and note behind *More*; after adding, the people and date stay for the next item), filter by person, search title, service and note, all items in the list's order |
| `/lists/<slug>/settings` | Name, description, fields, order, dashboard count; delete the list (type its name to confirm) |
| `/lists/new` | Create a list |
| `/items/<id>` | Edit an item, move it to another list, delete it |

## Lists and items

Every item has a title. Each list switches on the optional fields it uses:

| Field | |
|---|---|
| People | Any combination of the people (Jari, Elina, Anna-Linnea, Jussi), shown as coloured initials |
| Date | With the list's own label ("Watched", "Read", …); new items default to today (Europe/Helsinki) |
| Service | Free text with suggestions (Netflix, Yle Areena, HBO Max, …, plus what the list used before) |
| Link | Web address; `https://` is added when missing |
| Note | Free text |

Order: newest date first, newest added first, or title A-Z. **Moving** an item to another list (Movies to watch → Watched movies) keeps all its values; a target list with dates gives it today's date if it has none. Turning a field off only hides it: values stay and show again when it is turned back on.

Starting point (`migrations/001_init.sql`): the four people, *Watched movies* (people, date "Watched", service, link, note; first 5 on the dashboard) and *Movies to watch* (people, service, link, note; newest added first). People are a table without a page; adding someone is a new migration (`INSERT INTO people (name, position) …`).

## Dashboard

`GET /api/dashboard` (bearer `DASHBOARD_TOKEN` from secret `lists-api`) returns the lists whose *On the home dashboard* is set, each with that many first items in the list's order, and the people with their initials (contract: `ListsData` in `apps/dashboard/src/lib/types.ts`). The dashboard holds the same token as `LISTS_TOKEN` in secret `dashboard-lists`; a person's colour is their position in the people list in both apps.

## Access

No login: the app is reachable only on the home network (and the UDM's VPN), where every device can use it. It is not published through Cloudflare.

Secrets (not in git):

```sh
kubectl apply -f apps/lists/deploy/namespace.yaml
kubectl -n lists create secret generic lists-db --from-literal=POSTGRES_PASSWORD="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
# Dashboard feed: the same token on both sides.
T=$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')
kubectl -n lists create secret generic lists-api --from-literal=DASHBOARD_TOKEN="$T"
kubectl -n dashboard create secret generic dashboard-lists --from-literal=LISTS_TOKEN="$T"
unset T
```

## Operating

NetworkPolicies: default deny; web accepts Traefik and the dashboard, Postgres only web; no internet egress. Postgres is labelled for the nightly `pg_dump` (platform/components/backup). DNS: `lists.lab.internal` CNAME `ingress.lab.internal` on the UDM Pro.

## Develop

```sh
cd apps/lists && npm install
kubectl -n lists port-forward svc/postgres 55434:5432 &
DATABASE_URL="postgres://lists:$(kubectl -n lists get secret lists-db -o jsonpath='{.data.POSTGRES_PASSWORD}' | base64 -d)@127.0.0.1:55434/lists" npm run dev
npm run check   # svelte-check / TypeScript
```

## Deploy

```sh
./apps/lists/deploy.sh   # podman build, import into k3s (sudo), apply, wait for rollout
```

Commit the updated `newTag` in `deploy/kustomization.yaml`.
