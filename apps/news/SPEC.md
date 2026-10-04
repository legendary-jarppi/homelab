# Shilly Shally News — Requirement Specification

## 1. Introduction

### 1.1 Purpose

Shilly Shally News is a news aggregation web application for readers who are
sensitive to disturbing news content. It collects articles from many news
outlets, automatically classifies every article along two dimensions — its
subject matter and any potentially distressing content it contains — and then
shows each user only the articles that match the topics they care about while
hiding anything that crosses the content thresholds they have chosen.

The guiding principle is reader protection: a user who has asked never to see,
for example, content about violence or animal cruelty must not encounter such
content anywhere in the product, even incidentally.

A second, equally deliberate principle is that *sensitivity is personal*. The
product does not assume a single "squeamish reader" archetype. A war reporter
may be untroubled by conflict footage but unable to read about pregnancy loss; a
nurse may be fine with surgical detail but distressed by animal cruelty; an
arachnophobe may want nothing but to avoid a single close-up photograph. The
sensitivity model (§4.4) is designed for that diversity.

### 1.2 Scope

This document specifies the functional and non-functional requirements of the
system. It deliberately does **not** prescribe programming languages, web
frameworks, datastores, or AI runtimes; those choices are left to the
implementer. Where this document refers to a "topic taxonomy", "sensitivity
taxonomy", or specific category names, those are product/domain requirements and
must be honoured.

The keywords MUST, MUST NOT, SHOULD, and MAY are used in the conventional
requirement-specification sense.

### 1.3 Definitions

- **Outlet** — a news source (e.g. a newspaper or news website) that articles
  are fetched from.
- **Article** / **News item** — a single piece of news fetched from an outlet.
- **Topic** — a subject-matter category of an article (politics, sports, …),
  belonging to a **topic family**.
- **Sensitivity tag** — a label marking a kind of potentially distressing
  content in an article (graphic violence, animal suffering, …), belonging to a
  **sensitivity family** and carrying an **intensity**.
- **Intensity** — how strongly a sensitivity tag is present in an article:
  `mention`, `description`, or `graphic` (see §4.4.3).
- **Cluster / Story** — a group of articles from different outlets that report on
  the same real-world event.
- **Person** — a notable named individual mentioned in articles.
- **Categorization provider** — a pluggable backend that performs AI
  classification: an external LLM API or a locally hosted model (§4.1).

---

## 2. High-Level Architecture

The system MUST be composed of the following logical components, deployable
independently as containers:

1. **Frontend** — a web application (website) served to end users in a browser.
2. **Backend** — an HTTP API service implementing all business logic.
3. **Database** — a persistent datastore for all application data.
4. **AI categorization engine** — a pluggable classification service used to
   categorize articles. It MUST support at least one **external LLM provider**
   (Anthropic or OpenAI-compatible, authenticated with an API key) and MAY
   additionally support a **self-hosted local model**. See §4.1.
5. **Scheduler** — a background mechanism that periodically fetches and processes
   news. It MAY run inside the backend process.

General requirements:

- The frontend MUST communicate with the backend exclusively over a documented
  HTTP API.
- The backend MUST be stateless with respect to user sessions (see §6.2) so that
  it can be scaled horizontally; all durable state lives in the database.
- All user-facing UI text, labels, and internal code MUST be in English. Only
  the news content itself is in the source language of the outlet.

---

## 3. News Aggregation

### 3.1 Outlets

- The system MUST support a configurable set of news outlets. Each outlet has at
  least: a display name, a unique short slug, an optional feed URL, a website
  URL, an enabled/disabled flag, a fetcher type, and a **categorization priority**
  (see §4.8).
- Initially the system targets Finnish outlets (e.g. Helsingin Sanomat,
  Ilta-Sanomat, Iltalehti, Seiska, Yle, and others) and at least some
  English-language outlets. The architecture MUST therefore support
  **multi-language** content from the outset.
- It MUST be possible to enable or disable an outlet without removing its
  historical articles.
- Each outlet MUST have a configurable categorization priority that establishes a
  relative ordering between outlets. The priority MUST be adjustable by an
  operator/admin without code changes, and is used to control how quickly an
  outlet's articles become visible in the UI (see §4.8).
- A facility MUST exist to seed/initialise the default set of outlets, and this
  seeding MUST be idempotent (safe to run repeatedly).

### 3.2 Fetchers (extensibility)

- Each outlet is served by a **fetcher**. Adding a new outlet MUST require only
  implementing a new fetcher conforming to a common interface and registering it
  — no changes to core logic.
- The common fetcher interface MUST return a normalized list of raw articles,
  each with at least: a stable external identifier, title, source URL, and
  optionally body content, short summary, image URL, and publication time.
- The system MUST support at least two fetcher strategies:
  - **Feed-based** fetchers that read a structured syndication feed.
  - **Scraper** fetchers that extract articles from outlets without a usable
    feed.
- For outlets whose article pages are publicly accessible, the system MUST
  retrieve and store the **full article body**, not merely a feed excerpt, so
  that readers can read the whole piece inside the product without navigating to
  the outlet. This is required for reader experience (§7.2) and, more
  importantly, for correctness of sensitivity assessment: the intensity scale of
  §4.4.3 (`mention` / `description` / `graphic`) cannot be evaluated from a feed
  excerpt, and categorizing on excerpts would systematically under-tag intensity
  and therefore under-protect readers.
- Full-text retrieval MUST be a distinct **content phase**, separate from feed or
  listing discovery, and MUST record a per-article **content state** (see §10):
  pending, extracted, excerpt-only, or paywalled. There is deliberately no distinct
  "failed" state: an article whose content could not be retrieved, for any
  reason, is excerpt-only with a recorded reason, so that every article is always
  in a state from which categorization can proceed.
- The system MUST detect content it could not fully retrieve — including
  paywalled or truncated pages — rather than storing a partial stub as if it were
  the article. Detection SHOULD use, at minimum: a machine-readable
  free-access indicator where the outlet publishes one (e.g. schema.org
  `isAccessibleForFree`), an implausibly short extraction relative to what the
  feed advertised, per-outlet markers, and an operator-settable per-outlet flag.
- Where full text cannot be retrieved, the article MUST still be ingested,
  categorized on the material available, marked excerpt-only or paywalled, and
  remain visible subject to §5. Failure to extract content MUST NOT cause an
  article to be hidden indefinitely, and MUST NOT allow an outlet's behaviour to
  empty a user's feed.
- **The content phase MUST NOT be able to withhold visibility.** The wait before
  categorization MUST be bounded in **wall-clock time**, not merely in retry
  attempts: an article whose content has not resolved within a configurable
  deadline MUST be forced to excerpt-only and categorized. That deadline MUST be
  enforced by a mechanism independent of the content fetcher itself, and MUST
  still take effect when content fetching is disabled, when the responsible
  outlet is quarantined, and when the content worker is not running. Disabling
  content fetching MUST cause newly ingested articles to be treated as
  excerpt-only immediately, never left awaiting content.
- An article categorized while excerpt-only MUST be eligible for
  re-categorization if its full content is retrieved later. The system MUST
  provide an explicit mechanism for this; it MUST NOT be left implicit in the
  content state alone.
- Because an article categorized from an excerpt is assessed on materially less
  evidence, the system MUST compensate rather than present such an assessment as
  equivalent to a full-text one. At minimum: the categorizing model MUST be told
  that its input is partial and MUST resolve intensity uncertainty upward
  (§4.4.3); and a deterministic minimum intensity MUST be applied to any tag
  derived from partial content in the highest-harm families. The proportion of an
  outlet's articles assessed on partial content MUST be observable to operators.
- Content fetching MUST be a well-behaved crawler: it MUST respect the outlet's
  `robots.txt`, apply a configurable per-outlet request rate limit, send an
  identifying User-Agent, and use conditional requests (entity tags /
  if-modified-since) where the outlet supports them. The following transitions
  MUST be defined and MUST NOT consume retry attempts on a permanent answer:
  a crawl-policy refusal is terminal (excerpt-only, with a recorded reason); an
  outlet flagged as requiring authentication MUST NOT be fetched at all and is
  recorded as paywalled at ingest; and an unmodified-content response MUST leave
  the stored body and content state untouched and MUST NEVER promote an article
  with no retrieved body to the extracted state.
- Some outlets require authentication to access full content. The system MUST
  support configuring credentials for such outlets at the **system level**
  (i.e. operator-provided configuration/secrets), never per end user. Credentials
  MUST be supplied via configuration/secrets and MUST NOT be stored in source
  control. Credentialed retrieval of paywalled content is **out of scope for the
  initial release** (§13); the initial release MUST nevertheless provide the
  per-outlet flag, content-state model and fetcher interface needed to add it
  without a data migration.
- All outbound content retrieval — feeds, article pages, images, and
  user-submitted links (§7.5) — MUST pass through a single hardened HTTP client
  that: allows only http/https; resolves DNS and rejects private, loopback,
  link-local, unique-local and cloud-metadata address ranges; re-validates on
  every redirect and bounds redirect count; pins the validated address against
  DNS rebinding; caps response size and total time; and never forwards
  credentials across hosts. This MUST be enforced at the network layer as well as
  in code.

### 3.3 Fetch scheduling and storage

- The system MUST poll all enabled outlets on a recurring schedule. The polling
  interval MUST be configurable (default: hourly).
- Fetched articles MUST be stored locally in the database; the product does not
  rely on outlets remaining reachable to serve previously fetched news.
- Article ingestion MUST be **deduplicated** by external identifier so the same
  article is never stored twice.
- When article content includes embedded imagery, the system SHOULD select a
  representative image URL for display.
- After new articles are stored, the system MUST trigger AI categorization for
  any uncategorized articles.
- Fetch failures for one outlet MUST NOT prevent other outlets from being
  fetched, and MUST NOT corrupt previously stored data.

---

## 4. AI Categorization

### 4.1 Engine requirements

Categorization MUST be performed through a **provider abstraction** so that the
classification backend is a configuration choice, not a code choice.

- The system MUST implement a single internal categorization interface (input:
  article text and metadata; output: the structured result of §4.2) with at
  least the following interchangeable providers:
  1. **Anthropic API** provider (Claude models), authenticated with an API key.
  2. **OpenAI-compatible API** provider (ChatGPT / GPT models, and any
     API-compatible gateway such as Azure OpenAI or a local OpenAI-compatible
     server), authenticated with an API key.
  3. *(Optional)* **Local / self-hosted model** provider for operators who
     cannot or will not send content to a third party.
- Sending article content to an external, third-party AI service is **explicitly
  permitted**. A locally hosted model MUST NOT be required.
- The active provider, the model name, the API base URL, the API key, request
  timeouts, retry policy, and token/cost limits MUST all be settable purely
  through configuration (no code changes, no schema or data migration when
  switching providers or models).
- API keys and other provider credentials MUST be supplied via
  configuration/secret mechanisms and MUST NOT be committed to source control,
  logged, or exposed through any API response.
- If the local-model provider is implemented, it MUST be able to run on hardware
  **without a GPU** (CPU-only inference), accepting lower throughput.
- The engine MUST request **structured (machine-readable) output** from the model
  — using the provider's native structured-output/tool-calling/JSON-schema
  facility where available — and MUST robustly handle malformed or incomplete
  responses (treating them as a failure to be retried rather than crashing or
  producing partial records).
- The engine MUST handle provider-specific failure modes gracefully: rate
  limiting (HTTP 429) and transient errors MUST trigger bounded retry with
  exponential backoff; authentication and quota errors MUST be surfaced clearly
  to operators rather than silently marking articles as categorized.
- The engine MUST support a configurable **fallback provider**: if the primary
  provider fails persistently, the system MAY fall back to a secondary
  configured provider, and MUST record which provider and model produced each
  categorization.
- Categorization MUST process articles in batches with bounded concurrency,
  MUST respect a configurable maximum request rate, and MUST log progress,
  latency, and (where the provider reports it) token usage.
- The categorization prompt/instructions MUST be versioned, and the prompt
  version MUST be stored alongside each categorization result so that results
  produced by different prompts or models can be identified and re-run.

### 4.2 Categorization output

For each article the engine MUST produce:

1. **Topics** — one to three subject-matter categories from §4.3, each with a
   confidence score.
2. **Sensitivity tags** — zero or more distressing-content labels from §4.4, each
   with an **intensity** (`mention` / `description` / `graphic`) and a confidence
   score. An article with no distressing content has an empty list.
3. **Persons** — zero to a small number of notable real people mentioned, each
   with a canonical name, optional role/title, and confidence. Names MUST be
   normalised to a canonical base form (for inflected languages such as Finnish,
   grammatical cases MUST be normalised to the nominative/base form so the same
   person is recognised across articles).
4. **Summary** — a brief (1–2 sentence) summary of the article, written in the
   **same language as the article**. The summary MUST NOT itself contain graphic
   detail; it MUST be written so that it is safe to display to a reader who has
   not been filtered out by §5, and MUST NOT describe the distressing specifics
   of an article.
5. **Breaking flag** — a boolean indicating whether the article reports a major,
   urgent, or very recent developing event.
6. **Provider metadata** — the provider, model identifier, and prompt version
   used (stored, not user-visible).

### 4.3 Topic taxonomy (required categories)

The topic taxonomy follows conventional newsroom/news-agency sectioning. It is
organised into **families** (used for UI grouping and for coarse preferences)
containing **topics** (the values actually assigned to articles). The taxonomy
MUST include at least the following:

**News & Public Affairs**
- `politics-domestic` — domestic politics, parties, elections, legislation
- `government-administration` — public administration, municipalities, policy
- `world-news` — foreign news and international affairs
- `defence-security` — military, defence policy, national security
- `conflict-war` — armed conflict and its conduct
- `terrorism-extremism` — terrorism, violent extremism
- `law-justice` — courts, trials, legal system, policing policy
- `crime-incidents` — crime reports, accidents, emergency incidents
- `immigration-migration` — migration, asylum, integration

**Business & Economy**
- `economy` — macroeconomy, indicators, economic policy
- `business-companies` — companies, industry, corporate news
- `markets-finance` — stock markets, currencies, banking, investing
- `labour-work` — employment, unions, labour disputes, workplace
- `personal-finance` — consumer economy, taxation, saving, borrowing
- `real-estate-housing` — housing market, construction, rentals

**Science, Technology & Environment**
- `technology` — IT, software, telecoms, consumer tech
- `ai-data` — artificial intelligence, data, algorithms
- `science-research` — research results, space, basic science
- `environment-climate` — climate, nature, conservation, pollution
- `energy` — energy production, grids, fuel
- `transport-infrastructure` — traffic, public transport, infrastructure

**Health & Society**
- `health-medicine` — medicine, treatments, health services
- `mental-health` — mental health and wellbeing
- `education` — schools, universities, learning
- `social-issues` — inequality, welfare, social policy, human rights
- `religion-belief` — religion, faith communities, worldview
- `human-interest` — human-interest and community stories

**Culture, Sport & Living**
- `sports` — sport results, athletes, competitions
- `arts-culture` — literature, visual arts, theatre, museums, architecture
- `entertainment-media` — film, TV, music, gaming, media industry
- `celebrity` — celebrity news and gossip
- `lifestyle` — everyday life, relationships, home, fashion, style
- `food-drink` — food, cooking, restaurants, drink
- `travel-tourism` — travel and tourism
- `animals-pets` — animals, pets, wildlife (non-distressing framing)

**Service & Editorial**
- `weather` — weather and forecasts
- `local-news` — local/regional news
- `obituaries` — deaths, memorials, in-memoriam pieces
- `opinion-editorial` — columns, editorials, letters, commentary
- `analysis-explainer` — analysis, background pieces, explainers
- `fact-check` — fact-checking and misinformation debunking
- `other` — fallback when nothing else fits

Requirements:

- Every article MUST be assigned at least one and at most three topics.
- `other` MUST only be used when no other topic applies.
- Topic families MUST be selectable as a unit in user preferences (enabling a
  family enables all its topics), while individual topics remain
  independently toggleable.
- The taxonomy MUST be extensible by configuration/migration without code
  changes to the filtering logic.

### 4.4 Sensitivity taxonomy (required categories)

#### 4.4.1 Design intent

The sensitivity taxonomy is **not** a severity ladder of "how bad the news is".
It is a map of *distinct reasons a particular reader may need to avoid a
particular article*. It is therefore organised into **families** of related
triggers, so that:

- a reader can block a whole family with one switch ("nothing about death and
  grief"), or
- block one narrow tag inside a family ("I can read about death, but not about
  the death of children"), and
- two readers with completely different vulnerabilities are both served by the
  same model.

Tags are **descriptive, not moral**: a tag states what the article contains, not
whether it is objectionable.

#### 4.4.2 Required families and tags

**A. Violence & physical harm**
- `violence-interpersonal` — assault, fights, beatings
- `weapons-shooting` — firearms, shootings, stabbings
- `armed-conflict` — war, bombardment, military operations
- `terror-mass-casualty` — terror attacks, mass-casualty events
- `torture-extreme-cruelty` — torture, executions, deliberate cruelty
- `accidents-injury` — traffic and workplace accidents, serious injury

**B. Death, grief & loss**
- `death-general` — deaths, fatalities, obituary-style content
- `death-of-child` — death of or fatal harm to a child
- `pregnancy-loss-infant-death` — miscarriage, stillbirth, infant death
- `suicide-selfharm` — suicide, suicide attempts, self-injury
- `grief-bereavement` — mourning, funerals, loss narratives
- `missing-persons-abduction` — disappearances, kidnapping, abduction

**C. Harm to the vulnerable**
- `child-abuse` — abuse, neglect, or exploitation of minors
- `elder-disability-abuse` — abuse or neglect of elderly or disabled people
- `animal-suffering` — animal cruelty, neglect, slaughter, animal death
- `institutional-abuse` — abuse in care homes, schools, custody, churches

**D. Sexual content & sexual violence**
- `sexual-violence` — rape, sexual assault, sexual coercion
- `sexual-exploitation-trafficking` — trafficking, forced prostitution, grooming
- `explicit-sexual-content` — explicit sexual description or imagery
- `sexual-harassment` — harassment, misconduct, non-violent sexual wrongdoing

**E. Body, illness & medical**
- `graphic-medical` — surgery, wounds, autopsies, medical procedures
- `blood-gore` — blood, mutilation, human remains
- `serious-illness` — cancer, terminal illness, chronic disease narratives
- `epidemic-pandemic` — outbreaks, contagion, quarantine
- `needles-medical-anxiety` — injections, blood draws, hospital settings
- `body-image-eating-disorders` — weight, dieting, eating disorders
- `pregnancy-birth-fertility` — childbirth, fertility treatment, abortion

**F. Mental health & addiction**
- `mental-health-crisis` — psychiatric crisis, breakdown, involuntary care
- `substance-abuse` — drug and alcohol abuse, overdose
- `gambling-addiction` — gambling and gambling harm
- `psychological-abuse-coercion` — coercive control, manipulation, cults

**G. Identity-based hostility**
- `hate-speech-slurs` — quoted slurs, dehumanising language
- `racism-ethnic-hatred` — racist incidents, ethnic persecution, genocide
- `religious-persecution` — persecution on religious grounds
- `gender-based-hostility` — misogyny, misandry, gender-based hatred
- `lgbtq-directed-hostility` — hostility or violence toward LGBTQ+ people
- `disability-directed-hostility` — ableist abuse or discrimination
- `extremist-propaganda` — reproduction of extremist rhetoric or manifestos

**H. Fear, phobia & sensory triggers**
- `insects-arachnids` — insects, spiders, infestations
- `snakes-reptiles` — snakes and reptiles
- `rodents-vermin` — rats, mice, vermin
- `heights-falls` — heights, falling, cliff/building edges
- `confined-spaces` — caves, collapses, entrapment, being buried
- `deep-water-drowning` — drowning, open water, submersion
- `clusters-holes` — trypophobia-triggering imagery
- `horror-disturbing-imagery` — horror, corpses, uncanny or macabre imagery
- `flashing-strobe` — flashing, strobing or rapidly flickering media

**I. Disaster & existential threat**
- `natural-disaster` — earthquakes, floods, storms, wildfires
- `industrial-technological-disaster` — chemical, nuclear or transport disasters
- `climate-doom` — catastrophic climate framing, ecological collapse
- `nuclear-threat` — nuclear weapons, radiation threat
- `economic-collapse-threat` — crash, recession, mass-unemployment framing
- `ai-automation-threat` — existential or job-loss framing of automation

**J. Social & personal crisis**
- `domestic-violence` — intimate-partner and family violence
- `family-breakdown` — divorce, custody battles, estrangement
- `poverty-homelessness` — destitution, evictions, food insecurity
- `displacement-refugees` — forced migration, refugee hardship
- `bullying-harassment` — bullying, mobbing, online harassment
- `school-violence` — violence in educational settings
- `fraud-scams-financial-harm` — scams, fraud victims, financial ruin

**K. Presentation & tone**
- `graphic-imagery` — the article's imagery itself is distressing
- `sensationalism` — alarmist, outrage-driven or clickbait framing
- `profanity` — strong language
- `political-outrage` — high-conflict partisan rhetoric
- `true-crime-detail` — forensic/procedural detail of real crimes

Requirements:

- Every sensitivity tag MUST belong to exactly one family, and families MUST be
  filterable as a unit.
- The taxonomy MUST be defined in one place (§12.5) and used consistently by the
  prompt, the data model, the preferences UI, and the filtering logic.
- The taxonomy MUST be extensible: new tags and families MUST be addable via
  configuration/migration. New tags MUST default to **not enabled** for existing
  users unless an operator explicitly opts them in, so that adding a tag never
  silently hides content a user already chose to see.
- Users MUST additionally be able to define a personal **keyword blocklist**
  (free-text terms); articles whose title or summary match a blocked term MUST
  be hidden for that user. Matching semantics, including the handling of
  inflected languages, are specified in §5.1.3 clause 4. This complements, and
  does not replace, the taxonomy.

#### 4.4.3 Intensity scale

Every applied sensitivity tag MUST carry exactly one intensity value:

| Intensity | Meaning |
|---|---|
| `mention` | The subject is referred to in passing; no detail, no imagery. |
| `description` | The subject is a substantive part of the article and is described in concrete terms, without graphic detail. |
| `graphic` | The article contains vivid, explicit, or visually graphic treatment of the subject (including distressing imagery). |

Ordering: `mention` < `description` < `graphic`.

The model MUST also report a confidence score per tag. Where the model is
uncertain between two intensities, it MUST choose the **higher** one
(fail-safe toward protecting the reader).

This fail-safe rule is conditioned on *recognised* uncertainty, and therefore
does not protect against **partial input**: a model shown only a headline and a
two-sentence teaser is not uncertain, it is confidently assessing material it
cannot see. Whenever the text supplied to the model is partial — because content
retrieval did not yield the full article (§3.2), or because a long body was
abridged to fit a token budget (§12.3) — the system MUST declare that fact to
the model, so that the situation becomes one of recognised uncertainty and this
rule engages. Declaring partial input MUST NOT be the only compensation; see
§3.2 and §4.5.

Proportionality (`mention` versus `description`) MUST be judged against the
**whole** article, not against the abridged extract supplied. Where the body has
been abridged, the system MUST tell the model the original length and how much of
it was supplied, so that a passing reference in a long piece is not mistaken for
a substantive one.

Intensity assessment covers the article's **text**. Imagery is not assessed
(see §9.1.4), and any tag whose defining characteristic is visual is therefore
inferred from text alone.

### 4.5 Safety bias

- Where categorization is uncertain, the system MUST err on the side of tagging
  rather than not tagging.
- Articles whose categorization failed MUST be treated as unsafe and MUST NOT be
  shown in any user-facing feed until successfully categorized (§5.1).
- A configurable **global confidence floor** MAY be applied, below which a tag is
  still recorded but treated as present for filtering purposes; it MUST NOT be
  possible to configure the system to ignore low-confidence tags entirely.

### 4.6 Re-categorization

- Operators MUST be able to reset and re-run categorization for an individual
  outlet, for all outlets, or for all articles categorized with a given
  provider/model/prompt version (e.g. after switching provider or improving the
  prompt).
- Articles that fail categorization MUST be flagged and retried on a later cycle
  rather than being silently dropped.
- Re-categorization that the system performs **automatically** (for example when
  an article's full content arrives after it was assessed on an excerpt) MUST NOT
  be able to reduce protection: for each tag, the resulting intensity MUST be at
  least the intensity previously held. Automatic re-assessment may add tags or
  raise intensity; it MUST NOT remove a tag or lower an intensity. Only an
  explicit, operator-initiated re-categorization may reduce a tag, and such a run
  MUST be recorded in the audit trail with the acting operator, in the same way
  §8 requires for a manual correction that loosens filtering.
  Rationale: the system must not grant an outlet, by changing what it serves, a
  power the product denies to its own administrators.
- The rate at which re-categorization reduces tags or intensities MUST be
  observable, so that a systematic loosening — whether from a model regression or
  from an outlet altering what it serves to the system — is detectable.
- Manual admin corrections (see §8) MUST be preserved across re-categorization
  and MUST take precedence over AI-generated values.

### 4.7 Story clustering

- After categorization, the system MUST group recent articles (e.g. within a
  rolling recent window) that cover the same event into **clusters**, even when
  they come from different outlets.
- Clustering MUST be based on textual similarity of the articles (e.g. title,
  summary, body, and shared named entities), only grouping articles from
  *different* outlets together.
- Only multi-article groups constitute a cluster; single articles MUST NOT be
  presented as a cluster, and stale cluster assignments MUST be cleared when no
  longer valid.
- A cluster MUST be filtered per user as the union of its visible members: a
  cluster MUST NOT be shown if it has no member visible to that user, and MUST
  never display a member the user has filtered out.

### 4.8 Categorization priority

Because an article becomes visible to users only after it has been categorized,
the order in which the backlog of uncategorized articles is processed directly
determines how quickly each outlet's news reaches the UI.

- The categorization pipeline MUST process pending articles in an order that
  respects the per-outlet categorization priority (§3.1): articles from
  higher-priority outlets MUST be categorized before those from lower-priority
  outlets.
- Within the same priority level, articles SHOULD be processed newest-first (or
  by another sensible, documented tie-breaker).
- Categorization MUST consume an article only once its content phase (§3.2) has
  resolved — that is, once full text has been extracted or the article has been
  determined to be excerpt-only, paywalled, or unextractable — so that the model
  assesses the fullest available text. This wait MUST be bounded: after a
  configurable number of failed content attempts the article MUST be categorized
  on the material available rather than remaining uncategorized, and therefore
  invisible, indefinitely.
- Priority MUST affect processing order only; it MUST NOT change the resulting
  categorization, nor bypass any user content filters (§5).
- Changing an outlet's priority MUST take effect on subsequent categorization
  cycles without requiring code changes or redeployment.

---

## 5. Content Filtering Semantics

Filtering is the core safety feature and MUST be applied consistently across
every list, feed, search result, related-article list, person view, cluster
view, and individual article view that the product exposes.

### 5.1 Visibility rule

Given a user's preferences, an article is shown only if **all** of the following
hold:

1. **Categorized** — the article has been successfully categorized. Uncategorized
   or failed articles MUST NOT appear in user-facing feeds.
2. **Topic match** — if the user has any enabled topics, the article has at least
   one topic the user has enabled. (If a user enables no topics, this constraint
   is not applied.)
3. **Sensitivity threshold** — for every sensitivity tag the user filters on, the
   article MUST NOT carry that tag at an intensity equal to or above the user's
   threshold. Thresholds map as follows:
   - threshold `mention` → the tag is blocked entirely;
   - threshold `description` → only `mention` is allowed;
   - threshold `graphic` → `mention` and `description` are allowed.
   A family-level threshold is a **bulk-editing convenience applied at the moment
   the user sets it**: setting a family threshold assigns that threshold to every
   tag then in the family, and a per-tag threshold set afterwards wins. A family
   threshold MUST NOT act as a live inheritance rule evaluated at filtering time,
   because a tag added to the taxonomy later would then silently begin hiding
   content the user had previously chosen to see, which §4.4.2 forbids.
4. **Keyword blocklist** — the article's title and summary contain none of the
   user's blocked terms. Matching MUST be case- and diacritic-insensitive, and
   MUST match at **word beginnings** rather than requiring the stored term to
   appear verbatim.

   Verbatim substring matching is insufficient, and fails in the direction that
   harms readers. The product's primary content language is heavily inflected:
   a reader who blocks `hämähäkki` would still be shown articles about
   `hämähäkkejä` and `hämähäkeistä`, because Finnish alters the stem. The
   blocklist would therefore be materially weaker in Finnish than in English,
   silently, with no indication to the reader that it had not worked.

   Implementations SHOULD combine linguistic stemming with a conservative
   prefix match, so that a term is blocked when either signal fires. Matching
   MUST NOT use a user-supplied regular expression, and MUST NOT allow
   metacharacters in a stored term to alter the match (a term containing a
   wildcard must match literally, not hide every article).

   Over-blocking is the accepted failure direction here, consistent with §4.5.
   Two consequences are known, measured, and deliberately tolerated:

   - A short term yields a short stem, which can collide across languages: a
     term meaning "cat" in one language may share a prefix with an unrelated
     word in another, and articles containing it will be hidden.
   - Stem changes that prefix matching cannot reach (consonant gradation in
     Finnish, for example) will still be missed for short terms.

   These are recorded so that a future implementer does not "fix" the
   over-blocking without knowing that the alternative is silent
   under-protection. Any change to this rule MUST be justified against both
   failure directions, not just the visible one.
5. **Outlet preference** — if the user has outlet preferences, the article's
   outlet is one the user has enabled.
6. **Not muted** — the user has not individually muted the article.
7. **Not a personal submission** — user-submitted personal links (see §7.5) MUST
   NOT appear in the shared/aggregated feeds; they appear only in that user's own
   "my links" view.

### 5.2 Non-disclosure rule

- Sensitivity tags MUST NOT be displayed on article cards or detail views in a
  way that reveals the distressing nature of hidden content — surfacing them
  would defeat the product's purpose. (Topic badges MAY be shown.)
- Feeds MUST NOT show placeholders, gaps, counts, or "N articles hidden"
  indicators that would let a user infer what was filtered out.
- Directly requesting a single article that is blocked by the user's sensitivity
  settings MUST be denied (the content MUST NOT be returned), with a neutral
  response that does not describe *why* it was blocked beyond "filtered by your
  settings".
- Endpoints that **write** state against an article identifier — bookmarking,
  muting, marking read, adding to a collection — MUST enforce the same visibility
  rule as read endpoints, and MUST return responses indistinguishable between
  "blocked by your settings" and "no such article", so that article identifiers
  cannot be probed to discover hidden content. The acting user MUST always be
  derived from the authenticated session, never from request content.
- Paginated responses MUST NOT expose total counts, absolute offsets, or any
  positional information from which the number of filtered-out items could be
  inferred. Pagination MUST be cursor-based over the user's visible set; offset
  pagination MUST NOT be used for any article-derived list, because a short page
  at a stable offset discloses how many items were removed at that position.
- Summaries, titles and images of blocked articles MUST NOT leak through search
  indexes, related-article lists, cluster summaries, trending topics, trending
  persons, breaking tickers, or notification counts.

### 5.3 Opt-in reveal

- A user MAY be offered an explicit, per-article "show anyway" action **only**
  from a context where the article is already known to them (e.g. their own
  saved links, or a direct URL they pasted). It MUST require a deliberate
  confirmation, MUST NOT be enabled by default, and MUST NOT exist in ordinary
  feeds.

---

## 6. User Management & Security

### 6.1 Accounts

- The system MUST support multiple users. A user has a unique username, a unique
  email, a password, and a role.
- Users MUST be able to register and log in.
- Passwords MUST be stored only as salted hashes using an industry-standard
  password-hashing algorithm. Plaintext passwords MUST NOT be stored or logged.
- Registration MUST reject duplicate usernames or emails.

### 6.2 Authentication & authorization

- The API MUST use stateless, token-based authentication (a bearer token issued
  at login and presented on subsequent requests). Token lifetime MUST be
  configurable.
- Issued tokens MUST be revocable despite being stateless. Each user record MUST
  carry a token-generation marker that is embedded in issued tokens and verified
  on each request; changing a user's password (including an administrative reset,
  §8), changing their role, or an explicit "sign out everywhere" action MUST
  advance that marker and thereby invalidate all previously issued tokens.
  Without this, an administrative password reset leaves the compromised session
  fully usable.
- All news, preference, and personal-data endpoints MUST require authentication.
- There MUST be at least two roles: a regular **user** and an **admin**.
  Admin-only functionality (§8) MUST be inaccessible to regular users.
- Security is a non-negotiable requirement. Secrets (token signing keys, LLM API
  keys, outlet credentials, database credentials) MUST be supplied through
  configuration/secret mechanisms and MUST NOT be committed to source control.
  The signing key MUST be overridable for production.
- The backend MUST enforce a configurable cross-origin (CORS) policy.

### 6.3 Default preferences for new users

On registration, a new user MUST be initialised with restrictive, safety-first
defaults:

- **Topics**: all topics enabled (the user sees all subject areas by default).
- **Outlets**: all outlets enabled by default.
- **Sensitivity filters**: every tag in families **A (violence)**, **B (death &
  loss)**, **C (harm to the vulnerable)** and **D (sexual content & violence)**
  MUST default to threshold `mention` (blocked entirely).
- Families **E (body/medical)**, **F (mental health & addiction)**, **G
  (identity-based hostility)** and **J (social & personal crisis)** MUST default
  to threshold `description` (passing mentions allowed, detailed treatment
  blocked).
- Families **H (phobia/sensory)**, **I (disaster & existential threat)** and
  **K (presentation & tone)** MUST default to *not filtered*, but MUST be
  prominently offerable during onboarding.
- Onboarding SHOULD present a short, non-triggering wizard that lets a new user
  adjust these families before first seeing any content. Family and tag
  descriptions shown in the UI MUST be written in neutral, clinical language.

### 6.4 User preferences

Users MUST be able to view and update:

- Their **topic** preferences, at family and individual-topic level.
- Their **sensitivity** filters, at family and individual-tag level, choosing a
  threshold for each.
- Their **keyword blocklist**.
- Their **outlet** preferences (which outlets to include).

Because blocked terms match word beginnings (§5.1.3 clause 4), a reader may
occasionally find an unrelated article hidden by a short term. The system
SHOULD therefore let a reader choose, per term, between matching word
beginnings (the default) and matching whole words only, so that a reader who
encounters a false positive can narrow it themselves rather than abandoning the
term.

Preference changes MUST take effect immediately on subsequent feed requests.
Users MUST be able to export and re-import their filter configuration.

---

## 7. End-User Features

### 7.1 Feeds and browsing

The product MUST provide the following views, each respecting the filtering rules
in §5 and supporting pagination where appropriate:

- **Main feed** — all matching articles, newest first.
- **Frontpage** — matching articles laid out as a newspaper front page (§9).
- **For You** — a personalized feed that prioritises articles whose topics match
  the user's historical reading behaviour, drawn from unread articles. When no
  reading history exists, it falls back to recency.
- **Breaking** — recent articles flagged as breaking, within a short rolling
  window.
- **Stories / clusters** — the set of multi-outlet clusters, each summarised with
  a representative title, article count, contributing outlets, topics, and a
  representative image; and a per-cluster view listing all articles in a cluster.
- **By topic** — all matching articles for a given topic or topic family.
- **By outlet** — all matching articles for a given outlet.
- **Trending topics** — the most frequent topics over a recent window.
- **Search** — full-text search over article titles and summaries, respecting all
  filters.
- **Unread** — matching articles the user has not yet marked read.
- **New count** — a count of matching articles published since a given timestamp
  (to support "new articles" indicators).

### 7.2 Article detail

- An article detail view MUST show the title, full content (where available), the
  AI-generated summary, the source outlet, publication time, topics, associated
  persons, estimated reading time, and a link to the original source.
- The detail view MUST enforce sensitivity filtering (§5) and refuse to serve a
  blocked article.
- The detail view MUST expose **related articles** from the same outlet (filtered)
  and indicate cluster membership where relevant.
- Estimated reading time MUST be derived from article length.

### 7.3 People

- The system MUST maintain a directory of notable persons extracted from
  articles, each with a stable slug, name, and optional role.
- Users MUST be able to browse a paginated list of persons (with article counts,
  representative topics, and imagery), view **trending persons** over a recent
  window, and view all (filtered) articles associated with a given person.
- Person views MUST respect the user's content filters, including the person's
  article counts and imagery.

### 7.4 Personal organization

Each user MUST be able to:

- **Bookmark** articles and view a list of their bookmarks.
- **Mute** individual articles so they no longer appear in any feed, and unmute
  them.
- Mark articles as **read** (individually, and a "mark all read" action over the
  current filtered set), and have read/unread state reflected in the UI.
- Organize articles into named **collections** (create, delete, add item, remove
  item, list collection contents). Collections are ordered.

### 7.5 User-submitted links

- Users MUST be able to submit an arbitrary external link to save for themselves,
  optionally with a title.
- A user-submitted link is an **attacker-controlled request target**. Retrieval
  MUST use the hardened HTTP client mandated in §3.2, and MUST be subject to a
  per-user submission quota, since each submission triggers paid categorization
  (§11).
- Submitted links MUST be processed/categorized like other articles but MUST
  remain **private** to the submitting user and MUST NOT appear in shared feeds or
  other users' views.
- Submitted links MUST be deduplicated per user, and a user MUST be able to list
  and delete their own submitted links. The "my links" view MUST NOT apply
  sensitivity filtering (the user explicitly chose to save these), but SHOULD
  indicate that a saved link crosses their own thresholds before opening it.

### 7.6 Reading statistics

Each user MUST be able to see personal reading statistics, including at least:
total articles read, articles read per day over a recent period, a breakdown of
read articles by topic, their most-read outlets, and a current consecutive-day
reading **streak**.

---

## 8. Administration

The product MUST provide admin-only capabilities (restricted to the admin role):

- **Outlet management & monitoring** — list outlets with per-outlet statistics:
  total articles, categorized / uncategorized / failed counts, last fetch time,
  and a breakdown of sensitivity tags by tag, family and intensity. Outlets can
  be enabled or disabled.
- **Operational triggers** — manually trigger, per outlet or for all outlets: a
  fresh fetch, a re-fetch of full article content, and a re-categorization. These
  MUST run asynchronously in the background and return immediately.
- **Outlet priority management** — adjust the per-outlet categorization priority
  (§3.1, §4.8) used to order the categorization backlog.
- **Categorization provider monitoring** — view the active provider and model,
  recent error rates, rate-limit events, latency, and (where reported) token
  usage and estimated cost. API keys MUST NOT be displayed.
- **Content-retrieval monitoring** — view, per outlet, the distribution of
  content states, extraction sizes, crawl outcomes (including policy refusals and
  unmodified responses), and the share of articles assessed on partial content
  (§3.2). A sustained shift toward partial assessment for an outlet indicates a
  broken extractor or a site redesign, and is a reader-protection regression
  rather than a cosmetic one.
- **Article content purge** — an admin MUST be able to permanently remove the
  stored body of an individual article while retaining the article record, its
  summary and its classification. This is required to answer a rights-holder
  complaint about stored full text, or an erasure request from a person described
  in an article, without deleting the article's existence or re-exposing readers
  to it. Purged articles MUST NOT be re-categorized as though their body were
  simply absent.
- **Manual sensitivity correction** — an admin MUST be able to set, add, change,
  or remove the sensitivity tags (and their intensities) on a specific article
  when the AI has misclassified it. These manual corrections MUST override the
  AI-generated sensitivity tags, MUST be honoured immediately by the content
  filters (§5), and MUST be preserved across re-categorization (§4.6). The system
  SHOULD retain these corrections as a labelled feedback dataset and SHOULD use
  them to improve future categorization accuracy — for example as worked examples
  supplied to the model (few-shot prompting) or as training/evaluation data.
- **User-reported misclassification** — users SHOULD be able to report "this
  should have been filtered"; such reports MUST be queued for admin review and
  MUST NOT require the reporting user to re-describe the content.
- **Manual person tagging** — an admin MUST be able to associate a person with an
  article when the system failed to recognize that person (creating a new person
  record if one does not already exist, or linking an existing one). Admins SHOULD
  also be able to remove an incorrect person association. Manual person
  associations MUST be preserved across re-categorization (§4.6).
- **User management** — list users (with registration dates) and reset a user's
  password.
- **Analytics** — aggregate metrics including total articles, total users, total
  categorized articles, articles ingested per day, topic distribution, and user
  registrations per day over a recent period.

Equivalent operations SHOULD also be available through an operator
command-line/administrative tool (e.g. fetch, re-fetch content, re-categorize for
a named outlet or all outlets).

---

## 9. Frontend / User Experience

### 9.1 Visual identity: "modern broadsheet"

The product's visual language MUST evoke a classic printed newspaper — a
broadsheet front page and its inside sections — while behaving as a fully
modern, responsive, accessible web application. The intent is *editorial
calm*: the layout should feel considered, quiet, and typographic, in deliberate
contrast to the alarm-driven design of most news sites. Skeuomorphic gimmickry
(page-curl animations, faux paper folds, torn edges) MUST be avoided; the
newspaper feeling comes from typography, rules, and grid — not from textures
pretending to be physical objects.

#### 9.1.1 Masthead

- Every page MUST carry a **masthead**: the title "Shilly Shally News" set in a
  large high-contrast serif or blackletter-adjacent display face, centred,
  flanked by hairline rules.
- Directly beneath the masthead there MUST be a **dateline strip** in small caps
  / letterspaced uppercase: the current date, an edition label (e.g. "Morning
  Edition"), place of publication, and a subtle status such as "Last updated
  HH:MM".
- Beneath the dateline there MUST be a **section navigation bar** rendered as a
  single horizontal line of letterspaced small-caps links separated by thin
  vertical rules (Front Page · World · Politics · Economy · Culture · Sport · …),
  horizontally scrollable on narrow screens.
- On scroll, a condensed sticky bar MAY replace the masthead, retaining the
  wordmark, section links, search and the account menu.

#### 9.1.2 Typography

- Headlines MUST use a high-contrast transitional or Didone serif (e.g. Playfair
  Display, Libre Baskerville, Spectral); body text MUST use a legible reading
  serif (e.g. Source Serif, Charter, Lora). A condensed sans or small-caps face
  MAY be used for kickers, bylines, captions and labels.
- A strict **modular type scale** MUST be defined (at least six steps) and used
  consistently; headline size MUST encode editorial weight — the lead story's
  headline is visibly the largest item on the page.
- Every article card MUST be able to render, in order: **kicker** (small-caps
  topic/section label), **headline**, optional **deck/standfirst** (italic serif
  subheading), **byline/source line** (small caps: outlet · time · reading time),
  and **body or summary**.
- Body text MUST use a comfortable measure of roughly 60–75 characters per
  column, `text-wrap: pretty`/`balance` for headlines where supported, optional
  hyphenated justification for multi-column text, and generous leading.
- Long articles SHOULD open with a **drop cap** on the first paragraph and MAY
  use small-caps for the first few words.
- Web fonts MUST be self-hosted or otherwise privacy-respecting, subset, and
  loaded with `font-display: swap`; a serif system-font fallback stack MUST be
  defined so the page is readable before fonts load.

#### 9.1.3 Grid, rules and layout

- The front page MUST use a **multi-column newspaper grid** (up to 12 columns on
  wide desktop) with a clear hierarchy: one **lead story** spanning multiple
  columns, two to three **secondary stories**, a narrow **sidebar column** of
  briefs, and lower "below-the-fold" section blocks.
- Columns MUST be separated by **hairline vertical rules** (1px or sub-pixel,
  low-contrast ink colour), and major sections separated by horizontal rules,
  with occasional heavier "double rule" dividers for major breaks.
- Section blocks MUST be introduced by a **section head**: uppercase
  letterspaced label on a rule, in the manner of a printed section header.
- Short items MUST be presentable as **briefs**: dense, rule-separated one-
  or two-line entries in a narrow column ("In Brief", "Around the World").
- Text-heavy article bodies MAY use CSS multi-column layout on wide viewports,
  but MUST collapse to a single column below a defined breakpoint and MUST never
  require horizontal scrolling or produce broken column fragments.
- Responsiveness MUST be a reflow of the same grid, not a different design:
  desktop = full broadsheet; tablet = 2–3 columns; mobile = a single-column
  "column-inch" stack preserving rules, kickers and hierarchy.

#### 9.1.4 Colour and imagery

- Light theme ("Morning Edition") MUST use an off-white newsprint paper tone
  (approximately `#F7F4EC`–`#FBF9F3`), near-black ink (`#16130F`), a muted grey
  for secondary text, and a single restrained accent — a classic **printer's red**
  (approximately `#A32020`) reserved for breaking labels, section accents and
  links on hover.
- Dark theme ("Late Edition") MUST invert to a deep ink background
  (approximately `#14120F`) with warm off-white type, preserving the same
  hierarchy and rule structure. Theme MUST default to the system preference and
  persist the user's explicit choice.
- Paper texture, if used at all, MUST be an extremely subtle noise/grain overlay
  that MUST be disabled under `prefers-reduced-transparency` or when it reduces
  text contrast below WCAG AA.
- Images SHOULD be presented in an editorial print manner: desaturated or
  duotone/halftone treatment by default, hairline border or thin rule, and a
  small-caps italic **caption with credit** beneath. A "show original colours"
  affordance MAY be offered.
- Images MUST be lazy-loaded with reserved aspect-ratio boxes so the grid never
  reflows during loading.
- **Inline imagery within article bodies is not assessed for sensitivity.** The
  categorization engine evaluates text; it does not evaluate photographs.
  Because storing full article bodies (§3.2) brings outlets' inline imagery into
  the product, the reader MUST therefore gate such imagery on the **user's own
  sensitivity settings**, not on the article's assigned tags — the imagery-defined
  tags cannot be relied upon, precisely because nothing produces them from images.
  Specifically: for any user who filters one or more tags in the phobia/sensory or
  presentation families, inline body images MUST be collapsed behind a deliberate
  click-to-show placeholder by default. Captions and credits MAY be shown; the
  placeholder MUST NOT describe the image's content (§5.2).
- Every user MUST additionally be able to set an explicit image preference
  (always show inline / click to show / never show inline) that overrides the
  derived default above.
- Any textual alternative or caption accompanying an image MUST be supplied to
  the categorization engine (§4.2), as it is the only machine-readable signal
  about image content available to the system.

#### 9.1.5 Newspaper-flavoured components

- **Breaking ticker** — a single-line rule-bounded strip beneath the dateline,
  labelled in printer's red small caps ("Breaking"), scrolling only on hover/focus
  or not at all under `prefers-reduced-motion`.
- **Story clusters** — presented as a "the story so far" block: one headline, a
  rule, and a stacked list of contributing outlets set as bylines.
- **Trending topics** — a boxed sidebar list styled as a printed index, with
  leader dots between label and count.
- **Weather / date box** — an optional small boxed element in the masthead area.
- **Pull quotes** — large italic serif quotes with rules above and below inside
  long articles.
- **"Continued" affordance** — long article bodies MAY be truncated with a
  print-style continuation cue ("Continued ▸") that expands in place.
- **Skeleton loading** MUST be rendered as grey rule-and-block placeholders that
  match the newspaper grid, not as generic rounded shimmering cards.
- **Empty states** MUST be typographic and calm (e.g. a centred small-caps note
  "No further items in this edition"), and MUST NOT hint at filtered content
  (§5.2).

#### 9.1.6 Interaction and modern affordances

- The interface MUST remain a modern web app: client-side routing, optimistic UI
  updates, and no full page reloads for ordinary navigation.
- It MUST provide a **command palette** (keyboard-invoked) for quickly searching
  articles, navigating between sections, and running common actions (e.g. toggle
  theme, mark all read). Recent searches SHOULD be remembered locally. Its visual
  treatment MUST follow the same typographic system.
- It MUST provide **keyboard navigation/shortcuts** for power users, including
  moving between article cards, opening an article, a quick article **preview**
  overlay, bookmarking, muting, invoking search, and a discoverable shortcuts
  help overlay.
- A **reading progress indicator** SHOULD be rendered as a thin ink rule at the
  top of the viewport.
- Motion MUST be minimal and purposeful (fades and small offsets only), and MUST
  be honoured under `prefers-reduced-motion`.
- A **reader view** toggle SHOULD offer a single wide column with adjustable type
  size and measure for long-form reading.
- A **print stylesheet** MUST be provided that renders an article or the front
  page as a genuinely presentable printed page.

#### 9.1.7 Accessibility

- The design MUST meet WCAG 2.1 AA: contrast ratios, focus-visible outlines
  (rendered as ink rules rather than removed), semantic landmarks, correct
  heading order, and full keyboard operability.
- Decorative rules and ornaments MUST be hidden from assistive technology.
- Type size MUST respect user font-size settings; the layout MUST remain usable
  at 200% zoom and MUST NOT depend on fixed pixel heights for text containers.
- The newspaper grid MUST degrade to a linear, logical reading order for screen
  readers.

### 9.2 Functional UI requirements

- The website MUST be responsive and usable on both desktop and mobile.
- Article cards MUST display the kicker/topic, headline, summary, source,
  publication time, image (when present), reading time, and bookmark/read/mute
  controls — but MUST NOT reveal sensitivity tags (§5.2).
- Preference screens MUST present the topic and sensitivity taxonomies grouped by
  family, with plain-language, non-graphic descriptions and per-family bulk
  controls.
- The blocked-words screen MUST state that matching is by **word beginning**,
  and MUST give a concrete example. Without this the deliberate over-blocking of
  §5.1.3 clause 4 is indistinguishable from a defect, and a reader who sees an
  unrelated article disappear has no way to understand why. Suggested wording:

  > We hide articles where a word *starts with* what you type, so `hämähäkki`
  > also hides `hämähäkkejä` and `hämähäkeistä`. Short words may occasionally
  > hide more than you expect.

  The explanation MUST NOT list or hint at what was hidden (§5.2).
- The frontend MUST handle authentication state (login/register flows, storing
  the auth token, attaching it to API calls, and redirecting unauthenticated
  users appropriately).

---

## 10. Data Model (logical)

The implementation MUST persist at least the following entities and
relationships. Field types are illustrative, not prescriptive.

- **User** — id, username (unique), email (unique), password hash, role, created
  timestamp.
- **Outlet** — id, name (unique), slug (unique), feed URL (optional), website
  URL, enabled flag, fetcher type, categorization priority, requires-auth flag,
  content-extraction configuration (optional), crawl rate limit (optional).
- **Article / News item** — id, owning outlet, external id (unique), title, URL,
  body content (optional), **content state** (pending / extracted /
  excerpt-only / paywalled), content downgrade reason, content deadline,
  the content state the stored categorization was derived from,
  extracted and feed-advertised lengths, denormalised priority tier,
  body-purged timestamp, content-sanitizer version, content attempt
  count, image URL (optional), source summary (optional),
  AI-generated summary (optional), published timestamp, fetched timestamp,
  categorized flag, categorization-failed flag, breaking flag, cluster id
  (optional), submitting user (optional, for personal links), categorization
  provider, model identifier, prompt version, categorized timestamp.
- **User** additionally carries a token-generation marker (§6.2).
- **Topic family** — id, key (unique), display name, ordering.
- **Topic** — id, key (unique), family, display name, description.
- **Article–Topic** — links an article to a topic with a confidence score.
- **Sensitivity family** — id, key (unique), display name, description, default
  threshold for new users.
- **Sensitivity tag** — id, key (unique), family, display name, neutral
  description, default-enabled flag.
- **Article–Sensitivity tag** — links an article to a sensitivity tag with an
  **intensity** (`mention` / `description` / `graphic`) and confidence score, plus
  an **origin** marker distinguishing AI-generated tags from admin-set manual
  corrections (so corrections survive re-categorization).
- **Person** — id, name, slug (unique), role (optional), timestamps.
- **Article–Person** — links an article to a person with a confidence score, plus
  an **origin** marker distinguishing AI-extracted associations from admin-set
  manual ones.
- **Categorization feedback** — admin sensitivity corrections and user reports
  retained as labelled examples for improving future categorization (model
  prompting, evaluation, or fine-tuning).
- **User topic preference** — per user/topic, enabled flag (with optional
  family-level shortcut records).
- **User sensitivity filter** — per user, a threshold at family level and/or tag
  level; tag-level entries override family-level.
- **User keyword block** — per user, a blocked free-text term.
- **User outlet preference** — per user/outlet, enabled flag.
- **User bookmark**, **User muted item**, **User read item** — per user/article
  associations with timestamps.
- **Collection** — id, owning user, name, ordering position, created timestamp;
  with **collection items** linking articles into a collection.

Referential integrity MUST be maintained: deleting a user MUST cascade to that
user's preferences, blocked terms, bookmarks, mutes, reads, collections, and
personal links; deleting an outlet MUST cascade to its articles; deleting an
article MUST cascade to its topic/sensitivity/person associations.

---

## 11. Configuration

All deployment-specific values MUST be supplied via environment/configuration,
including at least:

- Database connection details.
- Authentication token signing key, algorithm, and expiry.
- **Categorization provider selection** (`anthropic` | `openai` | `local` | …).
- **Provider API key(s)**, API base URL(s), and model identifier(s) for the
  primary and optional fallback provider.
- Provider request timeout, max retries, max concurrency, and request rate limit.
- Optional daily/monthly token or cost ceiling, with defined behaviour when
  reached (pause categorization and alert; never mark articles categorized).
- Credentials for outlets that require authentication.
- Fetch interval.
- Allowed CORS origins.
- The frontend's backend API base URL.

Sensible local-development defaults MAY be provided, but production secrets MUST
be overridable and MUST never be hard-coded or committed. The system MUST fail
fast at startup with a clear message if the selected provider is missing its API
key or model configuration.

---

## 12. Non-Functional Requirements

### 12.1 Deployability

- The entire application — frontend, backend, and database — MUST be deployable
  as containers onto a local Kubernetes cluster. The AI categorization engine is
  an external service by default; if the local-model provider is deployed, it
  MUST be containerised too.
- The frontend MUST be exposable as a service from the cluster using a bare-metal
  load balancer (MetalLB), with a configurable IP address pool.
- Persistent components (database, and local model storage if used) MUST use
  persistent volumes so data and downloaded models survive pod restarts.
- The database SHOULD run as an appropriately-typed workload (e.g. a stateful
  workload) with health/readiness probes.
- The backend MUST expose health endpoints (including a check of categorization
  provider reachability), and the deployment MUST use readiness/liveness probes.
- Database schema MUST be managed by versioned migrations, runnable as part of
  deployment (e.g. an init step) before the backend serves traffic.
- A local development setup MUST also be provided (e.g. a single-command
  multi-container local stack) for running the full system on a developer
  machine, configurable to use either a real provider API key or a deterministic
  stub provider requiring no network access.

### 12.2 Reliability & operations

- Background fetching and categorization MUST be resilient: an error processing
  one article or one outlet MUST NOT halt the overall cycle.
- Concurrent categorization runs MUST be prevented from overlapping (e.g. via a
  lock), and a periodic job SHOULD pick up any pending/failed items for retry
  with backoff and a bounded attempt count.
- The system MUST log meaningful operational information (fetch counts,
  categorization progress, provider latency and token usage, clustering results,
  errors). Article content and API keys MUST NOT be written to logs at default
  log levels.

### 12.3 Performance & cost

- User-facing list endpoints MUST be paginated with a bounded maximum page size.
- Database queries serving feeds MUST eagerly load the related data needed to
  render article cards to avoid excessive per-item queries.
- Categorization is asynchronous; slow provider responses MUST NOT affect user
  request latency.
- The engine SHOULD reduce cost by truncating overly long article bodies to a
  configurable token budget while preserving the lead and any content most likely
  to carry sensitivity signals, and SHOULD avoid re-categorizing unchanged
  articles. Because full article bodies are stored (§3.2), truncation MUST NOT be
  a simple head-truncation: distressing material frequently appears in the middle
  or at the end of a piece, so the selected excerpt MUST include the lead plus
  the passages most likely to carry sensitivity signals.
- Passage selection MUST NOT be driven solely by a search for likely sensitive
  content, for three reasons: it would omit the families that search does not
  know about; it would present the worst passages of a long article as though
  they were the whole, distorting the proportionality judgement of §4.4.3; and
  where the text is attacker-influenced (§7.5) it would let the text choose what
  the system reads. Selection MUST therefore reserve part of the budget for
  passages chosen **structurally** rather than by content — at minimum the lead,
  the closing passage, and samples spanning the whole article — and MUST cover
  the entire sensitivity taxonomy rather than a subset of it.
- Any deterministic safety classifier the system applies independently of the
  model (§4.5) MUST be evaluated against the **complete stored text**, never
  against the abridged extract, so that abridgement cannot blind it.
- The token budget MUST be measured on the text actually presented to the model,
  excluding markup, so that the budget is spent on article prose.
- The abridgement strategy and any classifier vocabulary used to select passages
  form part of what determines the model's input, and MUST therefore be versioned
  and recorded alongside each categorization result (§4.1), so that results
  remain identifiable and re-runnable when either changes.
- Storing full article bodies materially increases datastore growth; capacity
  planning, volume sizing and usage alerting MUST account for it. Because volume
  is a planning estimate rather than a guarantee, the system MUST alert on
  unexpected growth in both stored volume and categorization spend, so that a
  runaway ingestion or retry loop is detected even while remaining within any
  configured ceiling.
- The engine MAY batch multiple articles per request where the provider supports
  it, provided that a failure in one article does not corrupt the results of
  others.

### 12.4 Privacy

- Operators MUST be informed, in documentation, that with an external provider
  article text is transmitted to a third party.
- User-identifying data (usernames, emails, reading history, personal
  preferences) MUST NOT be sent to the categorization provider. Only article
  content and metadata may be sent.
- For user-submitted personal links (§7.5), the system MUST make clear that the
  submitted content will be sent to the configured provider for categorization.

### 12.5 Quality & maintainability

- The codebase SHOULD favour clarity, maintainability, and long-term
  robustness over speed of delivery.
- Adding a new outlet MUST NOT require changes beyond a new fetcher and its
  registration/seed entry.
- Adding a new categorization provider MUST require only a new implementation of
  the provider interface plus configuration.
- The topic and sensitivity taxonomies MUST be defined in a single canonical
  place and used consistently by the AI prompt, the data model, the preferences
  UI, and the filtering logic.
- A regression test suite of labelled example articles MUST exist to verify that
  the filtering logic never leaks a blocked article, and SHOULD be used to
  evaluate provider/model/prompt changes before rollout.

---

## 13. Out of Scope (initial release)

- Social features between users (following, comments, sharing feeds).
- Editorial/manual curation of articles beyond the admin operations described.
- Mobile native applications (the responsive website is the only client).
- Fine-tuning or training of custom models (collecting feedback data for future
  fine-tuning is in scope; performing the training is not).
- Credentialed retrieval of paywalled article content (§3.2). The content-state
  model, per-outlet flag and fetcher interface that make it addable later are in
  scope; the authentication machinery is not.
- Per-user choice of categorization provider or per-user API keys.

