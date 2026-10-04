# Shilly Shally News — outlet ingestion research

All findings come from live fetches made on **2026-10-04, roughly 16:00–16:45 UTC**, from this host using curl. The User-Agent was `Mozilla/5.0 (compatible; ShillyShallyNews/0.1; +http://news.lab.internal)` unless a different one is named. Requests were rate-limited to at most 1 per second per host. Each outlet got about 5–15 page fetches. Counts, sizes and snippets below are what those fetches returned. Anything that could not be checked is marked **NOT VERIFIED**, and guesses are marked `[INFERENCE]`.

Column legend used throughout:
- **items / window**: number of feed items, and the time between the newest and oldest pubDate.
- **teaser**: median length (characters) of `<description>` or `content:encoded` after stripping HTML.
- **p**: the number of `<p>` elements over 40 characters inside the server-rendered article, as a quick check that Readability would work.

---

## Cross-cutting findings (read first)

1. **None of the 14 outlets puts the article body in JSON-LD `articleBody`.** Every outlet that returned article pages was checked, and none had it. The full body comes from one of two places:
   - an embedded state blob: Yle `window.__INITIAL__STATE__`, HS/IS `__NEXT_DATA__`, Iltalehti `window.App`, Alma Talent `window.__PRELOADED_STATE__`, BBC `window.__INITIAL_DATA__`;
   - or the server-rendered HTML: MTV, Seiska, Guardian, NPR, Länsiväylä.
2. **No RSS feed carries full text.** Guardian is the closest, with the standfirst plus the first 2–3 paragraphs (about 680 characters). Use RSS and sitemaps for discovery only, then always fetch the article page or API.
3. **Paywall signals.** The most reliable ones are:
   - the outlet's own state flags: HS/IS `paidType`/`showPaywall`, IL `subscription_level`, Alma Talent `lockedArticle`;
   - JSON-LD `isAccessibleForFree` plus `hasPart.cssSelector`: HS, IS, KL, US, LV and Seiska.

   Check both. Note that HS marks metered articles `isAccessibleForFree: true`.
4. **Paywall leak on Kauppalehti and Uusi Suomi (Alma Talent platform).** Locked articles still ship the **full body** in `__PRELOADED_STATE__`. For example, one KL article rendered 470 visible characters but had 6,926 characters of body text in the state. Using that text would be paywall circumvention. **The ingester must skip any article with `lockedArticle: true` and must never read the state body for those articles.**
5. **The User-Agent string matters at NPR.** www.npr.org resets the connection for any UA that contains `+http://…` or `+https://…`. Our default UA is rejected, but the same identity without the URL gets through: `Mozilla/5.0 (compatible; ShillyShallyNews/0.1; news.lab.internal)`. Recommendation: use a UA without a `+http` URL everywhere and put the contact URL in a `From:` header instead.
6. **Hard blocks.** AP (Cloudflare challenge) and Reuters (DataDome) block curl-class clients on every page, whatever the UA.
7. **Licensing and terms.** Several outlets say "no" in plain words: BBC robots.txt says "No scraping… No business use without permission". Reuters robots.txt says automated collection is "prohibited unless you have prior written consent". The Guardian allows non-commercial use only and requires a commercial key for images and third-party publishing. Alma Media's state blob says "withholds all rights … including the right to data mining". Seiska sets `Content-signal: search=yes, ai-train=no`. Showing full articles and images on our own site is republishing. The table rates technical viability and licensing risk separately.
8. **Images for sensitive-reader filtering.** Every outlet that returned article pages exposes captions and/or credits in a machine-readable form (details per outlet). Iltalehti goes further: each article carries a `metadata.sentiment` field (for example `["Negative","Sad_Tragic"]`), which can feed the sensitivity filter directly.

---

## 1. Yle Uutiset (yle.fi)

**Discovery**
| URL | status | items / window | teaser | images in feed |
|---|---|---|---|---|
| `https://yle.fi/rss/uutiset/paauutiset` (main headlines) | 200, 9.2 KB | 13 / 2026-10-04 05:30→19:10 (+03) | 114 | none |
| `https://yle.fi/rss/uutiset/tuoreimmat` (latest) | 200, 12.5 KB | 20 / ~11 h | 114 | none |
| `https://yle.fi/rss/t/18-34837/fi` (topic feed pattern `/rss/t/<tag-id>/fi`) | 200 | 20 / ~40 h | 115 | none |
| `https://yle.fi/rss/news` (Yle News, English) | 200 | 20 / 2026-09-30→10-02 | 107 | none |

The old `feeds.yle.fi/uutiset/v1/...` URLs redirect to the `yle.fi/rss/...` URLs above. Feeds contain teasers only and have no media tags.

**Sitemaps:** robots.txt lists no `Sitemap:` lines. `https://yle.fi/sitemap.xml` and `/news-sitemap.xml` both return 404. **No Google News sitemap was found.**

**robots.txt:** `User-agent: *` disallows `/ylefiroot-errors /cgi-bin /klaffi /java /player /errorsivut/ /global/ /haku/ /embed/ /karttasovellus/`. Article paths (`/a/…`) are allowed. There is no crawl-delay. About 35 named AI bots (GPTBot, ClaudeBot, CCBot, Scrapy…) are disallowed `/`. A custom UA is not affected.

**Article structure** (5 samples, e.g. `https://yle.fi/a/74-20249718`, `https://yle.fi/a/74-20240637`)
- All returned 200, 220–300 KB.
- JSON-LD `@graph` contains a `NewsArticle` with `image[]`. There is **no `articleBody` and no `isAccessibleForFree`**.
- `<script id="ukko-initial-state">window.__INITIAL__STATE__={…}` is about 93 KB of plain JSON. The useful part is `pageData.article`, with keys `id, language, url, headline, lead, mainMedia, authors, datePublished, dateContentModified, content[], subjects, …`.
  - In the long sample, `content[]` held 60 `text`, 4 `heading`, 4 `image`, 2 `video`, plus `aside`, `promo-content`, `form` and `links` blocks.
  - Text uses Markdown-style links (`[Suojelupoliisi](https://supo.fi/…)`).
  - Image blocks carry `caption`, `alt`, `source` (credit, e.g. `"Juha Kivioja / Yle"`) and `id` (e.g. `39-16979676a8f000166987`).
- The HTML is server-rendered: `<article>` holds 5–57 paragraphs, and the `<figcaption>`s include "Kuva: … / Yle". Readability-style extraction would work.

**Images:** URLs follow `https://img.img-cdn.yle.fi/<transforms>/<image-id>/<version>`, with Cloudinary-style transforms. Both of these were tested and returned image/jpeg:
- `https://img.img-cdn.yle.fi/w_640/f_auto/39-16979676a8f000166987` → 200, 68 KB
- `crop_fill,w_640,h_360/f_auto/...` → 200

So images can be resized freely from the image id.

**Paywall:** none (0 of 5 samples).

**Blocking:** none. Pages returned normally, with no consent wall in the HTML.

**API:** none for articles. developer.yle.fi says: "There is no public API for media, program schedule, or article data." Only teletext is available (with `app_id`/`app_key`).

**Recipe**
1. Poll `yle.fi/rss/uutiset/tuoreimmat` and `paauutiset`, plus chosen `/rss/t/<id>/fi` topic feeds. Strip `?origin=rss` from the links.
2. Fetch the article, parse `window.__INITIAL__STATE__`, map `content[]` blocks to the internal model, and build image URLs from the image ids.
3. No paywall check is needed. As a safety net, check `pageData.article` exists, and fall back to Readability.

**Rating: Easy / very high viability.**

---

## 2. Helsingin Sanomat (hs.fi)

**Discovery**
| URL | status | items / window | teaser | image |
|---|---|---|---|---|
| `https://www.hs.fi/rss/tuoreimmat.xml` | 200, 59 KB | 99 / 2026-10-03 12:08→10-04 16:25Z | 113 | `enclosure` on 79 of 99 |
| `https://www.hs.fi/rss/suomi.xml` | 200 | 100 / ~15 days | 110 | 49 |
| `https://www.hs.fi/rss/maailma.xml` | 200 | 100 / ~9 days | 119 | 77 |
| `https://www.hs.fi/rss/teasers/etusivu.xml` (front page) | 200 | 75 / ~2 days | 114 | 58 |

**Sitemaps** (from robots.txt):
- `https://www.hs.fi/rss/custom/news-sitemap.xml` → 200, **159 `news:news` entries**, publication dates 2026-10-02 19:59 → 10-04 19:25 (+03).
- `https://www.hs.fi/sitemap/html/hs/sitemapindex.xml` → 13,225 daily sitemaps going back to 1990.

**robots.txt:** `User-Agent: *` disallows `/promo/ /sivulaskuri /api/ /rest/ /public-transit-screen/ /tilaus/`. There is no crawl-delay. About 50 AI and scraper bots are disallowed `/`. A custom UA is fine.

**Article structure** (13 samples, e.g. `https://www.hs.fi/maailma/art-2000012319311.html`)
- All returned 200, about 580–650 KB.
- JSON-LD `NewsArticle` has `isAccessibleForFree` plus `hasPart: {"@type":"WebPageElement","isAccessibleForFree":false,"cssSelector":".paywall-section"}`. There is no `articleBody`.
- `__NEXT_DATA__` (about 33 KB) has `props.pageProps.page.assetData` with these keys:
  - `splitBody[]`: block types are `paragraph` (with `crumbs[]` holding text plus `marks` such as `leadin`, plus `personLink`), `img` (`{img:{url, caption, photographer, width, height}}`), `iframe`, `summary`, `citation`, and `articleadplaceholder`.
  - `mainPicture` with `{url:"…/normal/WIDTH.EXT", caption, photographer}`.
  - `paidType`, `showPaywall`, `authors`, `tags`.
- The HTML is server-rendered (`<article>` has 15–36 paragraphs on free articles).

**Paywall** (13 articles): `paidType` was `metered` for 10 and `paid` for 3.
- **Metered**: `showPaywall:false`. The full body is served to an anonymous client (for example 14 paragraphs/1,956 characters, or 32 paragraphs/4,582 characters). JSON-LD `isAccessibleForFree: true`.
- **Paid**: `showPaywall:true`. The body is truncated (3 paragraphs/288 characters). JSON-LD `isAccessibleForFree: false`.
- The 9 teasers in the front-page `__NEXT_DATA__` split 5 free, 1 metered, 3 paid. Front-page HTML teasers have `data-testid="paid-indicator" aria-label="Tilaajille"`.
- `[INFERENCE]` Getting metered articles in full depends on Sanoma continuing to serve them to cookie-less clients.

**Images:** URL template `https://images.sanoma-sndp.fi/<hash>/{normal|square}/<WIDTH>.<jpg|webp|avif>`. Only a fixed set of widths works:
- Seen in page markup: 115, 230, 320, 468, 658, 978. `978.jpg` → 200.
- `1440` is used in RSS enclosures, and `1440.webp` → 200.
- `640.jpg` → **400**.

Captions and credits are machine-readable (`caption`, `photographer`).

**Blocking:** none.

**Recipe**
1. Discover via `news-sitemap.xml` plus `rss/tuoreimmat.xml`.
2. Fetch the page and parse `__NEXT_DATA__` `assetData.splitBody`.
3. Ingest if `showPaywall == false` (paidType `free`/`metered`). Skip `paid`, and later fetch those with credentials.

**Rating: Medium / high viability** (about 75–80% of the sample is accessible). Credentials are needed later for `paid`.

---

## 3. Ilta-Sanomat (is.fi)

This is Sanoma's platform, the same as HS.

**Discovery**
| URL | status | items / window | teaser | image |
|---|---|---|---|---|
| `https://www.is.fi/rss/tuoreimmat.xml` | 200, 58 KB | 100 / ~20 h | 76 | 100 of 100 enclosures |
| `https://www.is.fi/rss/kotimaa.xml` | 200 | 100 / ~2.5 days | 79 | 94 |
| `https://www.is.fi/rss/viihde.xml` | 200 | 100 / ~4 days | 76 | 100 |

**Sitemaps:** `https://www.is.fi/rss/custom/news-sitemap.xml` → 200, **280 `news:news` entries** (2026-10-02 19:41 → 10-04 19:30, +03). Supersää and Iltapulu sitemaps are also listed.

**robots.txt:** same as HS, with extra `/iltapulu/...` rules. A custom UA is fine.

**Article structure** (11 samples, e.g. `https://www.is.fi/kotimaa/art-2000012310475.html`)
- Same JSON-LD (`hasPart .paywall-section`) and the same `__NEXT_DATA__ assetData.splitBody` as HS.
- Extra block types: `summary` (bullet points), `img` and `citation`. For example, the first sample had 18 paragraphs, 4 images and a summary.
- Image blocks look like `{"caption":"Merimetsoparvet ovat valtavia…","photographer":"Kari Suni"}`.
- The body text is server-rendered as `p.article-body`, but it is **not inside `<article>`**: the `<article>` element contained 0 matching paragraphs. Readability is likely to be unreliable here `[INFERENCE, not run]`, so use `__NEXT_DATA__`.

**Paywall:** all 11 sampled articles were `paidType: free`. In the front-page `__NEXT_DATA__`, 1 of 9 teasers was `paid`. Use the same detection as HS.

**Images:** same `images.sanoma-sndp.fi` fixed-width ladder as HS.

**Blocking:** none.

**Recipe:** identical to HS (`news-sitemap.xml` + `rss/tuoreimmat.xml` → `__NEXT_DATA__` → skip when `showPaywall`).

**Rating: Easy / very high viability.**

---

## 4. Iltalehti (iltalehti.fi)

**Discovery**
| URL | status | items / window | teaser | image |
|---|---|---|---|---|
| `https://www.iltalehti.fi/rss.xml` (linked from the homepage) | 200, 30 KB | 20 / ~6 h | 380 | `enclosure` + `media:content` 1024×640 (`media:credit` empty) |
| `https://www.iltalehti.fi/rss/uutiset.xml`, `/rss/kotimaa.xml`, `/rss/viihde.xml` | 200 | 20 each | 380–420 | yes |

**Sitemaps:**
- `https://www.iltalehti.fi/sitemap/iltalehti.xml` is an index of 334 monthly files (1999-01 to 2026-10).
- `…/iltalehti/202610.xml` has 551 URLs with `image:image` plus `image:caption`, and **no `news:news`**.
- Also listed: `categories.xml`, `weather/`, `telkku/`.

**Undocumented JSON API** (used by the site itself; `api.il.fi/robots.txt` returns a 404 JSON):
- `https://api.il.fi/v1/articles/iltalehti/lists/latest?limit=100` → 200, 100 items covering 06:52→19:36 (+03).
  - Item keys: `article_id, lead, headline, title, keywords, functional_keywords, subscription_level, category, main_image_urls, published_at, metadata`.
- `https://api.il.fi/v1/articles/<uuid>` → 200, 65 KB of full article JSON.
- Filters seen in the site navigation, e.g. `functional_keywords[]=plus_article`.

**robots.txt:** `User-agent: *` → `Disallow: /preview` only. About 70 named bots are disallowed, including `news-please` and `NewsNow`. There is no crawl-delay.

**Article structure** (5 samples, e.g. `https://www.iltalehti.fi/elintavat/a/c44daf19-2bac-4ebf-981b-771c64928787`)
- All returned 200, about 400 KB.
- **No JSON-LD at all.**
- `window.App={"state":…}` (about 283 KB) is a JS literal. It contains bare `undefined` values, which must be replaced before JSON parsing. The article lives at `state.articles[<uuid>].items` with these keys:
  - `body[]`: `paragraph` (with inline `items` such as text and italic), `image`, `advertisement`, `alma-embed`;
  - `images[]` with `caption`, `source` (credit, e.g. `"AOP"`), `width`/`height`, `urls{default,size30,…}`;
  - `subscription_level`, `metadata.sentiment` (e.g. `["Negative","Sad_Tragic"]`), `lead`, `authors`, `published_at`.
- The HTML is server-rendered (`<article>` has 9–42 paragraphs).

**Paywall:**
- Across the latest 100 from the API: `subscription_level` was `null` for 94, `paid` for 3, `login_required` for 2 and `paid_extra` for 1.
- A `paid` article fetched through the API had `body` truncated to 5 blocks (4 paragraphs + 1 image).
- Detection: ingest only when `subscription_level == null`.

**Images:** `img.ilcdn.fi` uses **signed Thumbor URLs**. A tampered signature returned 400, and the origin `img-s3.ilcdn.fi/<hash>.jpg` returned 401. Use the size variants the outlet already provides (`urls.default` and the sized keys, and 1024×640 in RSS).

**Blocking:** none.

**Recipe**
1. Poll `api.il.fi/v1/articles/iltalehti/lists/latest?limit=100` (or `rss.xml`).
2. For each item with `subscription_level == null`, fetch `api.il.fi/v1/articles/<uuid>` (or parse `window.App` from the page), and keep the `sentiment` field for the sensitivity filter.

**Rating: Easy / very high viability.** Credentials are needed later only for about 6%.

---

## 5. MTV Uutiset (mtvuutiset.fi)

**Discovery**
| URL | status | items / window | teaser | image |
|---|---|---|---|---|
| `https://www.mtvuutiset.fi/api/feed/rss/mtv_uusimmat_100` (linked from the homepage) | 200, 122 KB | 100 (oldest pubDate 2026-01-25, so it includes some evergreen items) | 103 | `media:content` on 100 of 100 |
| `https://www.mtvuutiset.fi/api/feed/rss/uutiset_uusimmat` | 200 | 20 / ~12.5 h | 89 | 20 |
| `https://www.mtvuutiset.fi/api/feed/rss/uutiset_kotimaa` | 200 | 50 / ~3 days | 96 | 50 |

**Sitemaps:**
- `https://www.mtvuutiset.fi/newssitemap` → 200, **130 `news:news` entries** (2026-10-02 19:43 → 10-04 18:56, +03).
- `sitemap.xml` is an index of 24 files.

**robots.txt:** `*` disallows `/pressi /api/fragment /*?*/api/fragment /*?*previewDate=`. Only UptimeRobot is blocked. The `/api/feed/rss/...` paths are not disallowed.

**Article structure** (5 samples, e.g. `https://www.mtvuutiset.fi/artikkeli/sahkoauto-paloi-karrelle-oulussa-syy-ei-ollut-akussa/9402168`)
- All returned 200, 730–800 KB.
- JSON-LD `NewsArticle` has an `image` ImageObject. There is no `articleBody` and no `isAccessibleForFree`.
- The site uses the Next.js App Router (`self.__next_f` RSC stream) plus `ApolloSSRDataTransport` chunks.
- **The body is server-rendered as plain `<p>`** (7–27 per article), but there is no `<article>` element.
- Image metadata sits in the RSC payload as `PictureImpl` objects with `alt`, `copyright` (e.g. `"Atte Kajova"`) and `caption`. Getting at it means parsing the RSC payload. Readability on the HTML gives the text but not reliable credits `[INFERENCE]`.

**Paywall:** none. All samples had `requiresLogin:false` and `requiresMtvLogin:false`.

**Images:** `https://api.mtvuutiset.fi/graphql/caas/v1/media/<id>/data/<hash>/landscape16_9/<width>/<name>.jpg`. Width 640 → 200, 29 KB, so the width can be changed freely.

**Blocking:** none.

**Recipe**
1. Discover via `newssitemap` plus the `uutiset_uusimmat` feed.
2. Run Readability (or a CSS-selected `<p>` list) for the text.
3. Regex or parse the `PictureImpl` objects for images and credits.

**Rating: Easy–Medium / high viability.**

---

## 6. Seiska (seiska.fi)

**Discovery:**
- `https://www.seiska.fi/latest.rss` (linked from the homepage) → 200, 189 KB, **150 items**.
  - **No `pubDate` on any item** (0 of 150).
  - `content:encoded` is the teaser, an `<img>` and a "Read more →" link. `media:content` is a webp image.
- `/sitemap.xml` and `/news-sitemap.xml` both return 404, and robots.txt has no `Sitemap:` line.

**robots.txt:** `Content-signal: search=yes, ai-train=no`. `User-Agent: *` gets `Allow: /` but disallows `/admin_/ /haku /auth/ /tag/ /*?page= /node/*/edit /*?jw_start=`. A dozen AI bots are blocked.

**Article structure** (5 samples, e.g. `https://www.seiska.fi/terveys/oho-joel-harkimon-diettisalaisuus-paljastui/2281361`)
- All returned 200, 160–250 KB.
- JSON-LD `NewsArticle` with `isAccessibleForFree: true` and an `image` ImageObject. There is no `articleBody`.
- Next.js RSC, with the body server-rendered in `<article>` (6–11 paragraphs).
- `<figcaption itemprop="caption">` and `<figcaption itemprop="author">` give the caption and credit (e.g. "Sara Friberg Kungl. Hovstaterna").
- The dataLayer has `"is_paywall":false`.

**Paywall:** 0 of 5. Detection: `dataLayer.is_paywall` and JSON-LD `isAccessibleForFree`.

**Images:** `https://image.seiska.fi/<id>.webp?width=640&height=360` (also takes `x`, `y`, `cropw`, `croph`) → 200, so images can be resized freely.

**Blocking:** none.

**Content note:** this is celebrity gossip, so expect heavy filtering for sensitive readers.

**Recipe**
1. Poll `latest.rss`.
2. Dedupe by the numeric id at the end of the URL.
3. Take the date from JSON-LD `datePublished`, because the feed has none.
4. Extract with Readability on `<article>`, and read the figure captions and credits through their `itemprop` attributes.

**Rating: Easy / high viability.**

---

## 7. Kauppalehti (kauppalehti.fi)

This is the Alma Talent platform (images on almatalent.fi), shared with Uusi Suomi.

**Discovery:**
- Feeds:
  - `https://feeds.kauppalehti.fi/rss/main` → 200, 10 items over ~5.5 h, teaser 145 characters, no images.
  - `/rss/klnyt` → 200, 9 items.
  - `www.kauppalehti.fi/rss` returns an HTML page, not a feed.
- Sitemaps:
  - The `sitemapindex.xml` index (lastmod 2026-05-18) points to `sitemap_latest.xml.gz`, which has 1,000 URLs but **lastmod only 2026-04-28 → 05-18**. It is **stale and not usable**.
  - There is no `news:news` sitemap.

**robots.txt:** the `User-agent: *` block is `Allow: /` with disallows for `/haku`, `/yritykset/yrityshaku/hakutulos` and `/api/pages/v2/listingpage/search`, plus **`Crawl-delay: 10`**. AI agents are allowed only `/yritykset/` and `/kumppanisisallot/`.

**Article structure** (5 samples from RSS, e.g. `https://www.kauppalehti.fi/uutiset/a/0b8e81e4-5fe3-436b-97f5-10412fd2ee71`)
- All returned 200, 530–830 KB.
- JSON-LD `NewsArticle` has `isAccessibleForFree` plus `hasPart{cssSelector:".article-body", isAccessibleForFree}`.
- `window.__PRELOADED_STATE__` holds `article[<uuid>].data` with:
  - `body[]`, a NewsML-like tree: `headline`, `preamble`, `body`, `subheadline1`, `x-im/image` (with `attributes.photographer`, caption text, and `uuid`), `alma/aside`, `alma/graffa-embed`, `x-im/infogram`;
  - flags: `freeArticle`, `lockedArticle`, `loginRequiredArticle`, `hardPaywallArticle`, `paywallOpen`, and others;
  - `leadImage`.
- The state also contains `_copyrightNotice`: "Alma Media withholds all rights to the content, including the right to data mining or text mining…".

**Paywall:**
- 4 of 5 RSS samples were `lockedArticle: true` (only 2–4 paragraphs rendered, JSON-LD `isAccessibleForFree:false`).
- On the homepage state, `lockedArticle` was true 66 times and false 100 times across teaser entries.
- **Leak:** locked articles carry the full body in `__PRELOADED_STATE__` (rendered 470 characters vs. 6,926 characters in the state). Do not use it.

**Images:** `https://images.almatalent.fi/[cx,cy,cw,ch,]<W>x/https://assets.almatalent.fi/image/<uuid>`. `640x` → 200 webp, so images can be resized freely.

**Blocking:** none, but respect the 10-second crawl-delay.

**Recipe (initial):**
1. Poll `feeds.kauppalehti.fi/rss/main` and `/klnyt`.
2. Fetch each page and ingest only when `lockedArticle == false && loginRequiredArticle == false` (the cross-check is JSON-LD `isAccessibleForFree == true`).
3. Read the free body from the state.

**Rating: Medium technically / low viability without credentials.** Credentials are needed later. Business-only content.

---

## 8. Uusi Suomi (uusisuomi.fi)

This uses the same Alma Talent platform as Kauppalehti.

**Discovery:**
- **No RSS found.** All of these failed:
  - `/rss`, `/rss.xml`, `/feed`, `/rss/uusimmat.xml`, `/rss/main`, `/rss/uutiset.xml` → 404;
  - `feeds.uusisuomi.fi` → DNS failure;
  - `feeds.kauppalehti.fi/rss/uusisuomi` → 401.
- The sitemap index's `sitemap_latest.xml.gz` has 1,000 URLs with **lastmod up to 2026-05-18 only (stale)**.
- What works:
  - homepage HTML: 16 `/uutiset/a/<uuid>` links;
  - `https://www.uusisuomi.fi/uusimmat`: 18 links;
  - the homepage `__PRELOADED_STATE__.frontPage.data`, which marks each teaser with `lockedArticle` (13 true, 72 false) and `freeArticle` (14 true).

**robots.txt:** the same shape as KL, with `Crawl-delay: 10` for `*`.

**Article structure** (5 samples from the homepage, e.g. `https://www.uusisuomi.fi/uutiset/a/4834ac79-4089-4218-a932-ecf33e02f659`): identical to KL. JSON-LD has `hasPart .article-body`, and `__PRELOADED_STATE__` has the same flags. The same paywall leak applies to locked articles, and the same rule holds: never use their state body.

**Paywall:** 3 of 5 samples were locked (JSON-LD `isAccessibleForFree:false`, about 640 characters rendered). Open articles had 2,879–5,205 characters.

**Images:** almatalent, the same as KL.

**Blocking:** none.

**Recipe:**
1. Scrape `/uusimmat` and the homepage every ≥10 minutes, using the teaser flags to prefilter.
2. Fetch only teasers with `lockedArticle == false`.
3. Extract from `__PRELOADED_STATE__` after re-checking the flags on the article itself.

**Rating: Medium–Hard (weak discovery) / medium viability.**

---

## 9. Länsiväylä (lansivayla.fi, Espoo)

This runs on the "diks" platform.

**Discovery:**
- `https://www.lansivayla.fi/feed/rss` (linked from the homepage) → 200, **30 items** over 2026-09-30 → 10-04, teaser 137 characters, `enclosure` image (LANDSCAPE_960) on 29 of 30.
- The `sitemap.xml` lists only 6 section URLs. There are no article or news sitemaps.

**robots.txt:** `User-agent: *` → `Disallow: /haku/` only. About 20 AI bots are blocked, with the comment "Scraping is not allowed for training AI language models".

**Article structure** (12 samples, e.g. `https://www.lansivayla.fi/paikalliset/9834780`)
- All returned 200, about 190 KB.
- JSON-LD `NewsArticle` has `isAccessibleForFree` **as a string** (`"False"`/`"True"`) and `isPartOf … productID "lansivayla.fi:showcase"`. There is no `image` and no `articleBody`.
- No state blob. The HTML is server-rendered.
- Paywalled pages show 1–2 paragraphs and then `<div class="diks-paywall">…<span class="diks-article__tag--subscribers-only">Vain tilaajille</span>`.
- `<figcaption class="diks-figure__caption">` includes the credit in `span.diks-figure__caption-info`.

**Paywall: 11 of 12 paywalled.** The only free article was an editorial (`/paakirjoitus-mielipide/9841733`, 10 paragraphs). Detection: JSON-LD `isAccessibleForFree == "False"`, or the presence of `div#diks-paywall`.

**Images:**
- URL form: `https://i.media.fi/incoming/<x>/<id>.jpg/alternates/<PRESET>/<id>.jpg`.
- Only fixed presets work: `FREE_960`, `FREE_1440`, `LANDSCAPE_960`, `PORTRAIT_960`, `SQUARE_240`, `SQUARE_960`, `WEBP_FREE_1440`, `OG_IMAGE_LANSIVAYLA`.
- An arbitrary preset (`FREE_640`) returned 400.

**Blocking:** none.

**Recipe (initial):** poll `feed/rss`, ingest only when `isAccessibleForFree == "True"`, and extract with Readability or the diks article container.

**Rating: Easy technically / NOT viable without credentials** (about 90% paywalled).

---

## 10. BBC News (bbc.com/news)

**Discovery**
| URL | status | items | teaser | image |
|---|---|---|---|---|
| `https://feeds.bbci.co.uk/news/rss.xml` | 200 | 29 (oldest 2025-04-30, a pinned item) | 116 | `media:thumbnail` 240 px |
| `https://feeds.bbci.co.uk/news/world/rss.xml` | 200 | 22 / ~2 days | 119 | 240 px |
| `https://feeds.bbci.co.uk/news/technology/rss.xml` | 200 | 21 | 89 | 240 px |

**Sitemaps:**
- `https://www.bbc.com/sitemaps/https-index-com-news.xml` points to 3 files.
- `…-news-1.xml` alone has 952 `news:news` entries over ~2 days, but only **242 are `/news/articles/`**. The rest are World Service languages, 167 sport entries, Newsround, and so on.

**robots.txt** (bbc.com and bbc.co.uk):
- `User-agent: *` does not block `/news/articles/`; it only disallows `/news/0`, search paths and similar.
- The header states: "**No scraping, crawling, or systematic extraction of content** … No business use without permission … No using BBC content to create summaries for your own use."

**Article structure** (5 samples; feed links point to `https://www.bbc.co.uk/news/articles/<id>`, fetched fine from Finland)
- All returned 200, 370–430 KB.
- JSON-LD `ReportageNewsArticle`, with no `articleBody`.
- `window.__INITIAL_DATA__="…"` is double-encoded JSON, about 160 KB. The article is at `data["article?…"].data.content.model.blocks` with types `headline`, `byline`, `text`, `image`, `media`, …
- Image blocks have `caption`, `alt`, `copyright` (e.g. "AFP via Getty Images") and `src`/`srcSet`.
- The HTML is server-rendered (`<article>` has 11–41 paragraphs).

**Images:** `https://ichef.bbci.co.uk/ace/standard/<width>/cpsprodpb/...`. Width 640 → 200, so images can be resized freely.

**Paywall:** none from Finland (0 of 5).

**Blocking:** none technically.

**Recipe** (only if licensed): world feed or news sitemap filtered to `/news/articles/` → `__INITIAL_DATA__` blocks.

**Rating: Easy technically / excluded on terms**, since robots.txt explicitly forbids scraping and business use without permission. A BBC licence would be needed.

---

## 11. The Guardian (theguardian.com)

**Discovery**
| URL | status | items | teaser | image |
|---|---|---|---|---|
| `https://www.theguardian.com/world/rss` | 200, 155 KB | 45 / ~5.5 days | **610** (standfirst + first 2–3 paragraphs, not full text) | 3 `media:content` sizes per item |
| `https://www.theguardian.com/international/rss` (linked from the homepage) | 200, 369 KB | 110 | 680 | yes |
| `https://www.theguardian.com/uk/rss` | 200 | 142 | 687 | yes |

Every section has a `/<section>/rss` feed.

**Sitemaps:** `https://www.theguardian.com/sitemaps/news.xml` → 200, **367 `news:news` entries** (2026-10-02 16:34Z → 10-04 16:32Z). These include `/live/` blogs, which should be filtered out.

**robots.txt:**
- `*` disallows only non-article paths (`/search`, `/discussion/*`, `/*/print$`, `/embed/`, …). Articles are allowed.
- The header says: "Any other uses are not permitted, incl. … for any **commercial purposes**. Contact licensing@theguardian.com."

**Article structure** (5 samples, e.g. `https://www.theguardian.com/world/2026/oct/04/egyptian-journalist-faces-terrorism-charges-entire-newsroom-detained-matsadaash-press-freedom`)
- All returned 200, 325–485 KB.
- JSON-LD `NewsArticle` with `isAccessibleForFree: true` and `image[]`. There is no `articleBody`.
- The `window.guardian` config blob holds no body.
- The HTML is fully server-rendered (DCR): `<article>` has 16–26 paragraphs. `<figcaption>`s contain the caption plus "Photograph: Matsadaash/AP".

**Images:**
- `https://i.guim.co.uk/img/media/<hash>/<crop>/master/<w>.jpg?width=…&s=<sig>`. Changing `width` while keeping the original signature returned **401**.
- `…?width=640&dpr=1&s=none&crop=none` (the form used in the page's own `<img src>`) returned **200**.
- `https://media.guim.co.uk/<hash>/<crop>/1000.jpg` returned 200 (the master is 1.1 MB).

**Paywall:** none (5 of 5 free, with a reader-support ask only).

**Blocking:** none.

**API:** Guardian Open Platform Content API.
- `https://content.guardianapis.com/search?api-key=test` returned **401 Unauthorized**, so the old test key no longer works and a key is required.
- Per `open-platform.theguardian.com/access/` (fetched):
  - **Developer** key: free, non-commercial, 1 call/s, 500 calls/day, "access to article text" (images are not listed).
  - **Commercial** key: "article text, images, audio and videos", explicitly covering "publishing content on third party sites"; price depends on usage.
- The API itself was **NOT VERIFIED** (no key).

**Recipe:**
- Preferred: get a key, then use `/search?show-fields=body,…&show-elements=image` (or `show-blocks`).
- Without a key: news sitemap or world RSS → server-rendered HTML through Readability, with figure captions and credits from `<figcaption>`.

**Rating: Easy technically / licensing-gated.** Showing full text and images on our site falls under the commercial tier.

---

## 12. AP News (apnews.com)

- `https://apnews.com/robots.txt` → 200.
  - `User-Agent: *` has an empty `Disallow:` plus `/*.rss`, `/api/v2/feed/`, `/apdata/`, `/gallery/`, `/press-release/*`, and others.
  - Sitemaps listed: `ap-sitemap.xml`, `news-sitemap-content.xml`, and others.
  - AI bots are disallowed.
- **Every other request returned 403 Cloudflare challenge** (`<title>Just a moment...</title>`, header `cf-mitigated: challenge`). This covered the homepage, `/world-news`, `/index.rss`, `/hub/ap-top-news.rss`, `/news-sitemap-content.xml` and `/ap-sitemap.xml`.
  - It happened with our UA, a desktop Firefox UA, `curl/8.9.1` and `ShillyShally/0.1`.
  - Only `robots.txt` got through, so the block is not just UA-based.
- **NOT VERIFIED:** feed contents, sitemap counts, article structure, images and paywall. None could be fetched.
- API: AP sells content through licensed products. This was **not fetched or verified** in this task.

**Rating: Not viable** (bot protection, and licensing needed).

---

## 13. NPR (npr.org)

**Blocking quirk:** `www.npr.org` drops the connection (HTTP/2 `INTERNAL_ERROR`, or a 25–45 s timeout) for UAs containing a `+http(s)://` URL. Tested:

| UA | Result |
|---|---|
| our default UA | fail |
| `Foo/1.0 (+http://example.com)` | fail |
| `Foo/1.0 (+https://news.example.com)` | fail |
| `Foo/1.0 (news.lab.internal)` | 200 |
| `ShillyShally/0.1` | 200 |
| `Mozilla/5.0 (compatible; Foo/1.0)` | 200 |
| `curl/8.9.1` | 200 |
| `NewsReader/0.1` | 200 |

Article fetches below used `Mozilla/5.0 (compatible; ShillyShallyNews/0.1; news.lab.internal)`. `feeds.npr.org` and `text.npr.org` accept the default UA.

**Discovery**
| URL | status | items / window | content | image |
|---|---|---|---|---|
| `https://feeds.npr.org/1001/rss.xml` (News) | 200 | 10 / ~29 h | `content:encoded` = lead image + teaser + "(Image credit: …)", 176 characters | `<img>` in `content:encoded` |
| `https://feeds.npr.org/1004/rss.xml` (World) | 200 | 10 / ~2 days | same | same |
| `https://feeds.npr.org/1002/rss.xml` | 200 | 10 | same | same |

**Sitemaps:** `https://googlecrawl.npr.org/news/sitemap_news.xml` → 200, **120 `news:news` entries** (2026-10-02 → 10-04).

**robots.txt** (first fetched with a browser UA because of the quirk, then confirmed with neutral UAs):
- `*` disallows `/*?*` (**any query string**), `/*/partials*`, `/proxy/`, `/player/`, `/templates/search/*`, and others.
- About 18 AI bots are disallowed.

**Article structure** (4 samples, e.g. `https://www.npr.org/2026/10/04/nx-s1-5990789/cornell-president-calls-gang-rape-allegations-deeply-disturbing`)
- All returned 200, 139–408 KB.
- JSON-LD `NewsArticle` with `image`; no `articleBody` and no `isAccessibleForFree`.
- No state blob. The body is server-rendered (15–30 paragraphs).
- Captions are in `div.caption p` and credits in `b.credit` / `span.credit[aria-label="Image credit"]` (e.g. "Matt Rourke/AP").
- One investigative page (`/nx-s1-5737621/fox-news-ukraine-deaths`) used a different layout, with no paragraphs inside the first `<article>`.
- The text-only mirror `https://text.npr.org/<id>` returned 200, 19 paragraphs, and **no images**.

**Images:** `https://npr.brightspotcdn.com/dims3/default/strip/false/crop/…/resize/<w>/quality/85/format/jpeg/?url=…`. Changing to `resize/640` → 200, so images can be resized freely. Many images are AP or Getty wire photos (from the credits).

**Paywall:** none.

**Recipe:**
1. Discover via the news sitemap (or the 1001/1004 feeds).
2. Fetch article URLs **without query strings**, using a UA with no `+http`.
3. Extract with Readability, and take captions and credits from `.caption`/`.credit`.

**Rating: Easy / high viability** once the UA is adjusted. `[INFERENCE]` NPR's terms of use were not checked.

---

## 14. Reuters (reuters.com)

- **robots.txt** (200) opens with: "Collection of content, data and/or information from reuters.com through **automated means is prohibited** unless you have prior written consent from Reuters". About 90 named partner and search bots get a normal ruleset. The final `User-agent: *` block is **`Allow: /plus/` + `Disallow: /`**, so unknown bots are disallowed everywhere.
- Homepage → **401 DataDome** ("Please enable JS and disable any ad blocker", `geo.captcha-delivery.com`), with both our UA and a desktop Firefox UA.
- Feeds: legacy `/rssFeed/worldNews` → 401 DataDome; `/arc/outboundfeeds/v3/all/?outputType=xml` → 404.
- The news sitemap index (`/arc/outboundfeeds/news-sitemap-index/?outputType=xml`) returned 200, listing 6 sub-sitemaps. That path is disallowed for `*` by robots.txt, so **no further fetches were made**.
- **NOT VERIFIED:** article structure, images and paywall. These were deliberately not fetched because robots.txt disallows them.

**Rating: Not viable** without a Reuters licence.

---

## Summary table

"Accessible share" is the share of sampled articles whose full text is served without credentials.

| Outlet | Lang | Discovery (best) | Body source | Image captions/credits | Image resize | Accessible share (sample) | Paywall signal | Blocking | Terms risk | Difficulty | Viability now |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Yle Uutiset | fi (+en) | RSS `tuoreimmat`/`paauutiset` + topic feeds (no sitemap) | `__INITIAL__STATE__` `pageData.article.content[]` | yes (`caption`, `source`) | free (`img.img-cdn.yle.fi` transforms) | 5/5 | n/a | none | low | Easy | **Very high** |
| Ilta-Sanomat | fi | news-sitemap (280) + RSS | `__NEXT_DATA__` `splitBody` | yes (`caption`, `photographer`) | fixed widths | 11/11 | `paidType`/`showPaywall`, JSON-LD `hasPart` | none | low–med | Easy | **Very high** |
| Iltalehti | fi | `api.il.fi` latest list / RSS | `api.il.fi/v1/articles/<id>` or `window.App` | yes (`caption`, `source`) + `sentiment` | signed (use provided sizes) | 94/100 | `subscription_level` | none | med (AI-bot list) | Easy | **Very high** |
| MTV Uutiset | fi | `newssitemap` (130) + RSS | server HTML `<p>`; RSC `PictureImpl` | yes (`copyright`, `caption`) | free (width in path) | 5/5 | `requiresLogin` | none | low | Easy–Med | **High** |
| Helsingin Sanomat | fi | news-sitemap (159) + RSS | `__NEXT_DATA__` `splitBody` | yes | fixed widths | 10/13 (metered) | `paidType`/`showPaywall` | none | med | Medium | **High** (credentials for paid) |
| Seiska | fi | `latest.rss` (no dates) | server HTML `<article>` | yes (`itemprop` caption/author) | free (query params) | 5/5 | `is_paywall`, JSON-LD | none | med (`ai-train=no`) | Easy | **High** |
| NPR | en | news sitemap (120) + feeds | server HTML | yes (`.caption`/`.credit`) | free (dims3) | 4/4 | n/a | **UA must not contain `+http`** | med (wire photos) | Easy | **High** |
| The Guardian | en | news sitemap (367) + RSS | server HTML (or Content API) | yes (figcaption "Photograph: …") | `s=none` works | 5/5 | n/a | none | **high** (commercial licence for republishing) | Easy | Technical yes / licence-gated |
| Uusi Suomi | fi | homepage + `/uusimmat` (no RSS, stale sitemap) | `__PRELOADED_STATE__` (unlocked only) | yes | free | 2/5 (homepage teasers 72/85 unlocked) | `lockedArticle`, JSON-LD | none (crawl-delay 10) | med (Alma TDM reservation) | Med–Hard | Medium |
| Kauppalehti | fi | RSS `main`/`klnyt` (10 items) | `__PRELOADED_STATE__` (unlocked only) | yes | free | 1/5 | `lockedArticle`, JSON-LD | none (crawl-delay 10) | med | Medium | Low (credentials) |
| Länsiväylä | fi | `feed/rss` (30) | server HTML | yes | fixed presets | 1/12 | JSON-LD `"False"`, `div#diks-paywall` | none | med | Easy | **Not viable** (credentials) |
| BBC News | en | world RSS / news sitemap | `__INITIAL_DATA__` blocks | yes (`copyright`) | free | 5/5 | n/a | none | **prohibitive** (robots "no scraping") | Easy | Excluded (licence) |
| AP News | en | — (robots.txt only) | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | **Cloudflare 403 challenge** | high | — | **Not viable** |
| Reuters | en | — | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | **DataDome 401** + robots `Disallow: /` | **prohibitive** | — | **Not viable** |

## Recommended initial outlet set (no credentials)

1. **Yle Uutiset** (fi; add Yle News English via `yle.fi/rss/news` if wanted): state JSON, no paywall.
2. **Ilta-Sanomat**: `__NEXT_DATA__`, almost everything free; skip `showPaywall`.
3. **Iltalehti**: JSON API with sentiment metadata; skip `subscription_level != null`.
4. **MTV Uutiset**: server-rendered, no paywall.
5. **Helsingin Sanomat**: metered articles are fully served; skip `paid` (about 1 in 4–5).
6. **Seiska**: free, server-rendered; heavy content filtering expected.
7. **NPR** (en): free, server-rendered; needs a UA without `+http`, and no query strings (robots `/*?*`).
8. **Uusi Suomi** (optional, phase 1b): unlocked articles only, with homepage/listing-page discovery and a 10-second crawl-delay.
9. **The Guardian** (en, conditional): technically trivial, but our use needs a commercial Open Platform key. Include it only if that licence is obtained. Otherwise NPR is the only English source that is open both technically and on terms.

**Need credentials later:** HS (`paid`), IS (occasional `paid`), Iltalehti (`paid`/`paid_extra`/`login_required`, about 6%), Kauppalehti (about 60–80% locked), Uusi Suomi (locked share), Länsiväylä (about 90% locked).

**Need a licence/contract instead of scraping:** BBC, Reuters, AP. AP and Reuters are also technically blocked.

## Implementation notes for the ingester

- Store a per-outlet `extractor` (state-JSON path vs. Readability) and a per-outlet `is_accessible(article)` predicate built from the signals above. Default to **skip** when the signal is missing.
- Never treat body text present in page state as accessible when the outlet's own lock flag says otherwise. This is the KL/US leak.
- Respect per-host robots rules and crawl-delay: KL and US use 10 s; NPR forbids query strings.
- Normalise URLs: strip `?origin=rss`, `?utm_source=rss` and `?at_medium=RSS…`. BBC feed links point to `bbc.co.uk`, while its sitemaps use `bbc.com`.
- Seiska RSS has no dates, so always take `datePublished` from the article's JSON-LD.
