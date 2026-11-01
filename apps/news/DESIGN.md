# Shilly Shally News: design

`SPEC.md` is the pre-generated requirement spec. This document records what we keep from it, what we
change and why, and the design we actually build. Where the two disagree, this document wins.

## 1. What must stay true

1. Readers are sensitive to different things, so every reader configures what to avoid.
2. It looks and reads like a traditional newspaper.
3. Every article is readable in full on our site, text and photos, without visiting the outlet.
4. Discovery uses RSS and also news sitemaps, outlet APIs and page scraping.
5. Paywalled articles are skipped unless the household subscribes; HS paid articles are read through
   a subscriber session (§4).

Plus one rule that follows from them: **a reader never sees what they asked not to see**, anywhere
(lists, search, article pages, photos, cluster "also in" lines), and nothing on screen hints at what was
hidden.

## 2. Spec review: kept, changed, dropped

| Spec | Decision | Why |
|---|---|---|
| Separate frontend + REST backend + bearer tokens (§2, §6.2) | **One SvelteKit server-rendered app + one worker**, sharing `src/lib/core`. Database sessions in an httpOnly cookie. | The only client is our website. Server rendering means filtered data never reaches the browser, so no API surface to probe. Database sessions are revocable by deleting rows; the spec's "token generation counter" exists only to patch the revocation problem that stateless tokens create. |
| Email + open registration (§6.1) | **Invite-only, no email.** Admin creates single-use invite links. | Friends and family. Open sign-up would turn a private reading room into a public republishing service (see §9 licensing). |
| Local model / provider abstraction (§4.1) | **Claude through the AI proxy only**, model chosen by benchmark (§5.4). One client (`llm.ts`) with structured JSON-schema output. | Accuracy matters more than self-hosting here; CPU-only local models on this host are too slow and too weak at the intensity judgement. The model is configuration (`LLM_MODEL`). No fallback provider: a failing call is retried later, and the article stays hidden until classified. |
| Images are **not** assessed; gate all inline images on the reader's settings (§9.1.4) | **Every stored photo is assessed by the vision model** in the same call as the text. Per-photo tags gate each photo individually against the reader's thresholds. Unassessed photos wait behind "Show photo". | Claude reads images. Assessing them removes the spec's biggest blind spot (a cheerful spider story with a close-up photo) and lets most readers see most photos. |
| Excerpt-only articles stay visible, with deadlines, minimum intensities and upward-only re-classification (§3.2, §4.6) | **Only fully extracted articles are classified and shown.** Paywalled, failed and skipped articles are stored for monitoring and never shown. | Idea 3: a teaser that sends the reader to the outlet is not a news item we can deliver. It also deletes a whole class of under-protection (classifying on teasers) and the machinery built to compensate for it. Outlets with a high paywall share (Länsiväylä, Kauppalehti) are simply not enabled until credentials exist. |
| Hourly polling | Discovery every 10-20 min per outlet (respecting crawl-delay); the **front page is live**, ranked from the past 36 hours (§7.1); a **Latest** column and page for everything as it arrives. | Editions (06:30, 12:00, 17:00) were tried first and dropped in November 2026: readers felt they were missing the latest news and went to the outlets' own sites instead. The page stays finite and calm (no ticker, no counts, no infinite scroll); it refreshes only when the reader comes back to it. |
| Breaking flag + ticker (§4.2, §9.1.5) | **Dropped.** Classifier gives an **importance** 1-5 used for front-page placement. | Tickers are alarm design. Importance gives the same placement signal without urgency cues. |
| Persons directory, trending persons (§7.3, §4.2) | **People and things, without trending.** A separate worker stage names up to 6 people, organisations, places and other things central to each article; each has a page of its visible stories. No trending lists or counts. | Dropped at first (prompt tokens, Finnish name normalisation, leak surface); added in November 2026 because readers wanted to follow a story's people and places. Normalisation is solved in the prompt (base form, established Finnish names), measured in §5.5; the leak surface is the usual `visibleTo` (§6). |
| Story clusters (§4.7) | **Kept, as de-duplication and coverage.** Embeddings (`text-embedding-3-small` via the proxy) of calm headline + summary; articles from different outlets within 48 h above a similarity threshold share a `cluster_id`. Lists show one visible member per cluster with "Also in Ilta-Sanomat, MTV"; the article page lists every version; the number of papers covering a story raises it on the front page. The same embeddings give **related stories** (§5.5). | Seven Finnish outlets report the same story; without this the front page repeats itself. Cross-language works (fi/en same-story cosine 0.69 vs 0.28 unrelated). |
| For You, trending topics, reading statistics and streaks, unread counts, new counts (§7.1, §7.6) | **Dropped.** | Engagement mechanics. Streaks and counts create pressure; personalised ranking narrows. Reading state is kept only to dim already-read headlines. |
| Collections, user-submitted links, export/import (§7.4-7.5, §6.4) | **Dropped for now; "Save" (one list) kept.** | Submitted links are an SSRF and cost surface for little gain in a household product. |
| Command palette, keyboard shortcuts, preview overlay, reader-view toggle, print stylesheet (§9.1.6) | **Search box + a print stylesheet only.** | Primary devices are iPad and phone. The article page already is the reader view. |
| Topic preference as "enabled topics" | **Hidden topics** (default none); an article is hidden when **any** of its topics is hidden. | Safer default when the taxonomy grows: a new topic is visible, not silently excluded. "Hide weather" then means no weather at all, not "weather unless it is also world news". Sensitivity tags keep the spec's rule: family thresholds are applied at the moment of setting, never inherited live. |
| "Show anyway" (§5.3) | **Dropped.** | No context in this product where it is needed. |
| Keyword blocklist on title + summary (§5.1) | Matches **title, calm headline, summary, body and captions**, with Finnish and English stemming plus accent-insensitive prefix matching. | A word the reader blocks can sit in paragraph 9. Over-blocking is the accepted direction. |
| MetalLB (§12.1) | k3s ServiceLB + Traefik ingress, like every app here. | Already the platform. |
| Spec §8 admin | Kept: outlet status and priority, pipeline monitoring, model latency/cost/errors, reports queue, tag corrections with audit (`tag_corrections`), body purge (the article leaves every reader page; the record and classification stay), users and invites. Dropped: person tagging, analytics dashboards. | |

## 3. Architecture

```mermaid
flowchart LR
  subgraph cluster[namespace news]
    web[web: SvelteKit SSR] --> pg[(Postgres 17)]
    worker[worker: discovery, extraction, photos, classification, clustering, entities, related stories] --> pg
    web --> imgs[(image volume)]
    worker --> imgs
  end
  worker -->|robots.txt, rate-limited| outlets[news outlets]
  worker -->|Messages API + embeddings| proxy[AI proxy]
  reader((reader)) -->|news.lab.internal| web
```

- `src/lib/core/`: shared by web and worker (relative imports only): taxonomy, db, http, outlets,
  extraction, images, llm, classify, visibility, auth, prefs.
- `src/lib/i18n/`: the interface language (web only), §7.4.
- Photos are downloaded once, stored as WebP under the image volume and served by the web app. The
  reader's browser never contacts an outlet.
- The worker is the only component with internet egress (NetworkPolicy); web reaches only Postgres.
- Schema: versioned SQL migrations (`migrations/NNN_*.sql`), applied at start by whichever of web
  and worker starts first (advisory-locked runner).

## 4. Ingestion

Per outlet, one module in `src/lib/core/outlets/` with `discover()` and `extract(url)`; see the
research in `docs/outlets.md`. Body sources are the outlets' embedded state JSON (Yle, IS, HS,
Iltalehti) or server-rendered HTML (MTV, Seiska, NPR); never the JSON-LD `articleBody` (nobody sets it).

- **Discovery**: RSS, Google News sitemaps, outlet listing APIs. URLs normalised (tracking parameters
  removed) and de-duplicated by URL.
- **Extraction** produces our own block model (`blocks.ts`): paragraphs, subheads, quotes, lists and
  figures. No outlet HTML is stored or rendered.
- **Paywall**: the outlet's own lock flag decides, never text length. A locked article is stored as
  `paywalled` with no body, **even when the page ships the full text in its state JSON** (Alma Talent
  does this; reading it would be circumvention).
- **Subscriber sessions** (`sessions.ts`, Sanoma flow in `outlets/sanoma.ts`): for outlets the
  household subscribes to, the worker owns a dedicated login (secret `COOKIES_<SLUG>`: the outlet's
  login cookie copied from a private browser window). Sanoma serves one shared CDN copy of every
  article page, so the worker follows the HS web app: login cookie → short-lived session token
  (`/api/safe/v2/web/session-token`; single-flight, cached until expiry, because the login cookie
  rotates on every exchange) → Sanoma's access service, whose `access-granted` answer carries the
  subscriber body in the same `splitBody` format. Cookies go only to the outlet's own https hosts and
  the token only to the access service, never across redirects; the newest login cookie is kept in
  `outlet_sessions`. The access service decides, as the paywall flag does for anonymous pages; every
  paid article doubles as a session check shown on the admin Outlets page. Automating the login
  itself was rejected: it runs behind DataDome bot detection and a scripted login risks the account.
  The site is household-only, which keeps this within the personal subscription.
- **Crawler manners**: single hardened client (`http.ts`): robots.txt per host, per-host pacing and
  crawl-delay, identifying User-Agent plus `From`, size and time caps, private address ranges blocked
  (also by NetworkPolicy).
- **Initial outlets**: Yle, Ilta-Sanomat, Iltalehti, MTV Uutiset, Helsingin Sanomat (free and metered
  articles), Seiska, NPR. Not enabled: Kauppalehti, Uusi Suomi, Länsiväylä (mostly locked); BBC,
  Reuters, AP, Guardian (terms forbid or require a licence).

## 5. Classification

### 5.1 One call per article
Input: headline, standfirst, full body (structurally abridged above 40 000 characters, with the length
declared), captions, and up to 8 photos as 768 px JPEGs. Output (JSON schema): 1-3 topics, sensitivity
tags with intensity and basis (text/images/both), per-photo tags, calm headline, neutral summary,
importance 1-5, kind (news, opinion, ..., sponsored), language. The long system prompt (taxonomy) is
identical for every call, so the proxy's prompt cache serves it.

### 5.2 Safety rules in code, not only in the prompt
- Unclassified or failed articles are never visible.
- A tag found on a photo is also an article tag at that intensity.
- Duplicate tags keep the highest intensity.
- Sponsored content is never shown.
- Admin corrections (`origin = 'manual'`) override AI tags and survive re-classification.

### 5.3 Priority
Queue order: outlet priority, then newest first. Classification runs with bounded concurrency.

### 5.4 Model choice
**`claude-sonnet-5-5`** (`LLM_MODEL`), from `docs/benchmark.md` (20 real, mostly sensitive articles,
each model run twice, `claude-opus-5-5` as reference): p50 3.9 s / p90 4.9 s, the fastest measured;
23-25 % under-calls against the stable reference versus 40-42 % for `claude-sonnet-5` and 48-54 % for
`claude-haiku-4-5`; it caught phobia animals in photos, and its calm headlines and summaries match
Opus. `claude-opus-5-5` is ~1.5 s slower and the most accurate; switching is a one-line config change
if its price is acceptable. Haiku is ruled out (missed half the tags, wrote a false summary).

Clustering: `text-embedding-3-small`, cosine >= 0.70 to an article from another outlet within 48 h
(measured on 29 000 cross-outlet pairs: >= 0.80 same report, 0.70-0.80 same event, below 0.70 false
pairs appear).

### 5.5 People and things, related stories
Two worker stages after classification, neither of which affects whether an article is visible:

- **Entities** (`pipeline/entities.ts`): one text-only call per article (`ENTITY_MODEL`, headline,
  standfirst and the first ~8 000 characters) names at most 6 people, organisations, places and other
  things (events, teams, works, laws) central to it, most central first. The prompt asks for base
  (nominative) forms and established Finnish names also for English articles ("Yhdysvallat", "Nato"),
  so one entity has one row across outlets and languages: `entities` is unique on kind + lower-cased,
  unaccented name. Backfills the last `ENTITY_BACKFILL_DAYS` (30), newest first. Benchmark (15 Finnish
  + 3 NPR articles): `claude-haiku-4-5` produced a wrong base form ("Raahes") and an English event name;
  `claude-sonnet-5-5` got every name right at ~1.5 s and ~$0.004 per article, so it is the default.
- **Related** (`pipeline/related.ts`): the 8 nearest articles by embedding within ±7 days, outside
  the article's own cluster, at cosine >= 0.55 (`RELATED_FLOOR`), stored in both directions. Measured
  on 300 articles: 0.45-0.55 shares only genre or format; 0.55-0.60 the same theme; 0.60-0.70 the same
  theme or a follow-up. At 0.55 an article gets 3 related stories on average and a third get none.

## 6. Filtering

`visibility.ts` is the one SQL predicate every reader query uses. It enforces: classified and
extracted, not sponsored, at least one non-hidden topic, outlet not hidden, no effective tag at or
above the reader's threshold, not muted (reporting an article also mutes it), no blocked-term match.
Leak tests in `tests/visibility.test.ts` run against real Postgres.

Non-disclosure: no tags on cards or pages, no counts, no "N hidden", cursor pagination only, the
article URL of a hidden article returns the same 404 as a missing one, and the "Also in" line of a
cluster lists only members visible to this reader. The same holds for related stories, the stories
listed under an entity, and entity pages: an entity none of whose stories the reader can see answers
with the 404 of a missing one. Front-page coverage (how many papers report a story) counts only
visible members.

Photos: setting **show** (default) shows a photo when it was assessed and none of its tags hit the
reader's thresholds; anything else is behind a neutral "Show photo" button that names nothing. **Ask
first** puts every photo behind the button; **no photos** removes them.

## 7. Reader experience

### 7.1 Principles
- **Finite and calm, but live.** The front page is ranked from the past 36 hours, one story per
  cluster, by `importance + 0.8 · ln(papers covering it) − hours since its newest report / 6`, so a big
  story stays up while it develops and everything else gives way to fresher news (`ranked()` in
  `src/lib/server/articles.ts`). Beside it, *Latest* lists the ten newest stories with "12 min ago".
  The page ends ("The front page changes as the news comes in.") instead of scrolling forever, and it
  reloads only when the reader returns to it after five minutes, never under the reader's eyes. No
  badges, counters, red dots or autoplay.
- **Stay in the paper.** Every byline links to its paper's page; the article page shows the same
  story in other papers, related stories, the people and things in it, more from the paper and the
  section, and the next unread top story, so the outlet's site is never the only way onward.
- **Calm headlines by default.** The classifier's rewrite replaces clickbait; the outlet's headline is
  shown small on the article page. A setting turns it off.
- **Reader control is one tap away.** On every article: *Save*, *Share*, *Not for me* (mutes it) and
  *This upset me* (hides it at once and queues it for admin review; no description needed). *Share*
  passes on a share link, `https://news.shillyshally.org/share/<token>` (`PUBLIC_BASE_URL`; the token is
  the article id with an HMAC under `SHARE_SECRET`, so links cannot be made up and nothing is stored):
  the system share sheet over https, else it copies the link (plain http has neither the share sheet
  nor the clipboard API), else shows it to copy by hand. The Home Screen app has no address bar, so this
  is the only way to pass an article on there. `/share/` is the one path Cloudflare Access lets through:
  link-preview fetchers (WhatsApp, Signal, Messages, Telegram, Slack, … by User-Agent) get Open Graph
  tags with the calm headline, the summary and a photo only if it was assessed and got no sensitivity
  tag at all (the preview ignores every reader's settings), as JPEG; anyone else is redirected to
  `/article/<id>`, behind Access and the site's login as before. So whoever holds a link can see that
  preview, never the article. The recipient needs Access and an account, and sees the article only if
  their own settings let it through. Without `SHARE_SECRET` Share passes the plain article address.
- **Same design on every device**, reflowed: broadsheet grid on desktop, 2-3 columns on iPad, a single
  "column inch" stack on phones. Touch targets at least 44 px.

### 7.2 Pages
| Path | Content |
|---|---|
| `/` | Live front page (§7.1): lead story (largest headline, photo, summary), 3 secondary stories and the *Latest* column (ten newest, "12 min ago"); one block per section; *By paper*: each paper's top three of the past day under its nameplate. One story per cluster, except in *By paper*. |
| `/section/<key>` | Section front: the section's stories ranked as the front page, then "Earlier" (older than the 36-hour window, cursor). |
| `/latest` | Everything visible, newest first. Plain list, cursor pagination. |
| `/papers`, `/papers/<slug>` | `/papers`: each enabled paper's nameplate with its top four stories of the past day (no counts). `/papers/<slug>`: that paper's top stories now (ranked as the front page), then all its visible stories newest first, every cluster member (not one per cluster), with a picker to switch papers; cursor pagination. A paper the reader hid in settings says so instead of listing anything. Every byline's paper name links here, and a second line under the section bar lists the papers on every page. |
| `/entity/<id>` | A person, organisation, place or other thing: its visible stories, newest first; the newest three as cards. 404 when the reader can see none of them. |
| `/login/check` | After signing in: on to the page asked for, or back to `/login` with an explanation when the browser did not return the session cookie. |
| `/article/<id>` | Kicker, calm headline, standfirst, byline line (outlet, time, reading time), "Also in" line linking each other paper's version, lead photo, body with drop cap and figures, original headline and "Read at <outlet>" link, actions, *Read next* (the highest-ranked unread story). Wide screens put two rails beside the text: left, every version of the story in other papers (visible members only) and more from the same paper; right, related stories, people and things (each with its newest other stories and a link to its page) and more from the section. Narrower screens stack the rails under the article. |
| `/search` | Full-text search (Finnish and English stemming) over visible articles. |
| `/saved` | Saved articles, still filtered (a saved article that a later settings change hides disappears). |
| `/settings` | Comfort level, sensitivity by family and tag, topics, outlets, blocked words, photos, headlines, theme, password, sign out everywhere. |
| `/welcome` | First-run: 1) what this is, with the interface language, 2) pick a comfort preset (4 cards), 3) optional fine-tuning of families, 4) photos and headlines, 5) done. Before any news is shown. |
| `/login`, `/join/<code>` | Sign in; redeem invite. |
| `/admin` | Outlets, pipeline and model health, reports with tag correction, users and invites. |

### 7.3 Visual system ("modern broadsheet")
- Masthead: *Shilly Shally News* in UnifrakturMaguntia between hairline rules; dateline strip in
  letterspaced small caps: weekday and date, "Espoo", "Updated" with the time the newest story came in.
- Section bar: one line of small-caps links with thin vertical rules, horizontally scrollable on
  phones; condensed sticky bar on scroll. Under it, a line of the papers' names in Playfair Display.
- Type: Playfair Display (headlines, size encodes importance on a 7-step modular scale), Source Serif 4
  (body, 60-72 characters per line, `text-wrap: pretty`), Libre Franklin (kickers, bylines, captions,
  UI). All self-hosted via Fontsource, `font-display: swap`, serif fallbacks.
- Colour: newsprint `#F7F4EC`, ink `#16130F`, one accent (printer's red `#A32020`) for section kickers
  and focus; dark "Late Edition" `#14120F` with warm off-white. Theme follows the system unless set.
- Rules, not boxes: hairline column rules, double rules between major blocks, section heads as
  small-caps labels on a rule. No cards, shadows or rounded corners.
- Photos: hairline frame, caption in italic serif with small-caps credit; slightly muted saturation
  for a print feel; aspect-ratio boxes so nothing reflows.
- Accessibility: WCAG AA contrast, visible focus rings drawn as ink outlines, landmarks and heading
  order follow the reading order, layout survives 200 % zoom, `prefers-reduced-motion` honoured.

### 7.4 Interface language
Finnish or English, per reader (Settings → Language, also on the first welcome step): *Automatic*
follows the browser (English when the browser prefers English to Finnish, otherwise Finnish), or a
fixed choice. Only the interface is translated: navigation, labels, settings, taxonomy names
(`src/lib/i18n/taxonomy.ts`; the English names in `core/taxonomy.ts` also go into the classifier
prompt) and dates (Finnish style: "Sunnuntai 1. marraskuuta 2026", "Eilen 18.20"). Articles, calm
headlines and summaries stay in the language they were written in. Messages live in
`src/lib/i18n/messages/` as `{ en, fi }` pairs with the Finnish side type-checked against the English
keys and parameters. The admin pages stay English.

## 8. Operations
- Containers: one image, two entrypoints (`node build/index.js` web, `node build/worker.js` worker).
- k8s: namespace `news`, Postgres StatefulSet (local-path volume), image PVC shared by web and worker
  (single node, ReadWriteOnce is fine), Traefik ingress `news.lab.internal`, NetworkPolicy (web:
  Postgres only; worker: Postgres, DNS and public internet only, no private ranges).
- Secrets (not in git): `news-db` (`POSTGRES_PASSWORD`), `news-llm` (`LLM_API_KEY` from the omp config).
- Logs: counts, latencies, token usage; never article text or keys.

## 9. Risks
- **Licensing.** Showing full articles and photos is republishing. Acceptable only as a private,
  invite-only reading room for family and friends; it must not be opened to the public. Several
  outlets reserve text-and-data-mining rights; BBC, Reuters, AP and Guardian are excluded for that
  reason.
- **Classifier misses.** Mitigated by: full text plus photos, "include when unsure" prompt, highest
  intensity wins, photo tags lift article tags, reader report path, admin corrections.
- **Site redesigns** break extractors. Admin outlet view shows per-outlet extraction states; a jump in
  `failed` means an extractor needs fixing.

## 10. Phases
1. **Now**: everything above, for the seven initial outlets.
2. **Next**: subscriber sessions for Iltalehti; few-shot examples from `tag_corrections` in the
   prompt. HS (and IS) subscriber sessions are in place.
3. **Later**: public exposure through Cloudflare Tunnel only if licensing allows (it currently does
   not), English-language outlets with a licence.
