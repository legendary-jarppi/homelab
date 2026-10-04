# news

Shilly Shally News at http://news.lab.internal: a private, invite-only newspaper for readers who want
to avoid distressing news. Articles from Finnish outlets (and NPR) are fetched in full with their
photos, classified by Claude (topics, sensitivity tags with intensity, per-photo tags, calm headline,
summary, importance), de-duplicated across outlets, and shown to each reader only when they pass that
reader's own settings. The front page is published as editions at 06:30, 12:00 and 17:00.

Design and the reasons behind it: [DESIGN.md](DESIGN.md) (supersedes the older [SPEC.md](SPEC.md)).
Outlet research: [docs/outlets.md](docs/outlets.md). Model choice: [docs/benchmark.md](docs/benchmark.md).

**Privacy and licensing.** Article text and photos are sent to the AI proxy for classification. The
site republishes full articles, which is acceptable only as a private reading room for family and
friends: keep it invite-only and never expose it publicly.

## Layout

| Path | What |
|---|---|
| `src/lib/core/` | Shared by web and worker: taxonomy, db, crawler HTTP client, outlets (one module per outlet), extraction block model, images, LLM client, classifier, visibility rule, editions, auth, preferences |
| `src/lib/core/pipeline/` | Worker stages: discovery, content (extraction + photos), classification, embeddings/clustering |
| `worker/main.ts` | Worker entrypoint; environment variables documented at the top |
| `src/routes/` | Reader pages, `/welcome` onboarding, `/settings`, `/admin` |
| `migrations/` | Versioned SQL, applied by the web pod at start |
| `deploy/` | Postgres, web, worker, photo volume, ingress, NetworkPolicies |

## Operations

| Task | How |
|---|---|
| Invite someone | Admin page *Users & invites*, or `node --experimental-strip-types scripts/invite.ts [--role admin] --note "Name"` with `DATABASE_URL` set (prints a single-use join link, valid 14 days) |
| Outlet health, re-run discovery, re-extract, re-classify | Admin page *Outlets* |
| Model latency, errors, tokens; queues | Admin page *Pipeline*; `kubectl -n news logs deploy/worker` |
| First admin after a fresh install | `scripts/invite.ts --role admin` locally through the Postgres port-forward (see Develop), then open the printed link |
| Misclassified article | Readers tap *This upset me* (hides it for them at once). Admin page *Reports* → correct tags (overrides the AI, survives re-classification, recorded in `tag_corrections`) |
| Rights-holder request | Admin article page → *Purge stored text* (removes text and photo files; the article leaves every reader page) |
| Change model | `LLM_MODEL` in `deploy/kustomization.yaml`, then `kubectl apply -k apps/news/deploy`. Re-classify from the admin page if wanted |
| Add an outlet | New module in `src/lib/core/outlets/` implementing `OutletDef` (`types.ts`), register it in `outlets/index.ts`; the worker seeds it on start |

Secrets (not in git):

```sh
kubectl -n news create secret generic news-db --from-literal=POSTGRES_PASSWORD="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
# LLM key: the omp proxy key
python3 -c "import yaml,os; print(yaml.safe_load(open(os.path.expanduser('~/.omp/agent/models.yml')))['providers']['sc-ai-proxy-anthropic']['apiKey'], end='')" > /tmp/llmkey \
  && kubectl -n news create secret generic news-llm --from-file=LLM_API_KEY=/tmp/llmkey; shred -u /tmp/llmkey
```

### Subscriber login (Helsingin Sanomat)

Paid HS articles are read with a dedicated HS login owned by the worker. The article page itself is
one shared CDN copy, so the worker does what the HS web app does: it exchanges the login cookie
`__Secure-sndp-refresh` for a short-lived session token at `www.hs.fi/api/safe/v2/web/session-token`
and asks Sanoma's access service (`puomi.sanoma-sndp.fi`) for the subscriber part of the body. HS
replaces the login cookie on every exchange; the worker keeps the newest one in `outlet_sessions`,
so **a copied login must never be used by a browser again**. No password is stored. Everyone on
this site (the household) sees paid HS articles. Ilta-Sanomat works the same way with `COOKIES_IS`.

1. Open a private window, log in at https://www.hs.fi and open any article; let it finish loading.
2. Developer tools → cookie storage for `https://www.hs.fi` (Chrome *Application*, Safari and
   Firefox *Storage*) → copy the **Value** of `__Secure-sndp-refresh`. (Not the `Cookie` request
   header: it carries the previous cookie, which the page replaces right after loading.)
3. Close the private window at once, without logging out.
4. Store it and restart the worker (the value is read at start; a new value replaces the stored login):

   ```sh
   read -rsp 'Value of __Secure-sndp-refresh: ' C && echo
   kubectl -n news create secret generic news-outlet-auth --from-literal=COOKIES_HS="__Secure-sndp-refresh=$C" \
     --dry-run=client -o yaml | kubectl apply -f -
   unset C
   kubectl -n news rollout restart deploy/worker
   ```
5. Admin → *Outlets* → Helsingin Sanomat → *Re-fetch paywalled*.

The *Subscriber login* line on the Outlets page shows whether the latest paid article opened. When
it says *Expired*, repeat steps 1-5. Only one worker may use the login: a local worker run while
the cluster worker holds the lock waits, which is safe. Remove the secret to stop: `kubectl -n news
delete secret news-outlet-auth && kubectl -n news rollout restart deploy/worker`.

## Develop

```sh
cd apps/news
npm install
kubectl -n news port-forward svc/postgres 15432:5432 &
printf 'DATABASE_URL=postgres://news:%s@127.0.0.1:15432/news\n' \
  "$(kubectl -n news get secret news-db -o jsonpath='{.data.POSTGRES_PASSWORD}' | base64 -d)" > .env
# plus LLM_API_KEY=... for the worker; chmod 600 .env
set -a && . ./.env && set +a
npm run dev                                   # web on :5173 (applies migrations)
node --experimental-strip-types worker/main.ts   # worker (IMAGE_DIR defaults to ./.cache/images)
node --experimental-strip-types scripts/outlet-smoke.ts yle 5   # check one outlet's extractor live
npm test        # extractor fixtures, clustering, and leak tests against the database (rolled back)
npm run check   # svelte-check / TypeScript
```

Running a local worker while the cluster worker runs is safe (advisory lock; the second one waits).

## Deploy

```sh
./apps/news/deploy.sh   # podman build, import into k3s (sudo), apply, wait for rollout
```

Commit the updated `newTag` in `deploy/kustomization.yaml`. DNS: `news.lab.internal` CNAME
`ingress.lab.internal` on the UDM Pro.
