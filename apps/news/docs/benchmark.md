# Classifier model benchmark

Run on 2026-10-04 with `scripts/benchmark.ts` (prompt `v1`, `src/lib/core/classify.ts`), through
the AI proxy. Raw results: `.cache/benchmark.json` (not in git); regenerate the tables with
`node --experimental-strip-types scripts/benchmark.ts --report-only`.

## Method

- **Articles**: 20 real extracted articles from 5 outlets (Iltalehti 3, HS 5, IS 4, MTV 4, Yle 4),
  hand-picked to be mostly sensitive: crime (a murder trial with 9 photos, child rape verdict, Norway
  shooting, knife arrest), war (Kyiv strikes video, Yemen offensive, Gaza genocide interview),
  accidents and disasters (Cyprus ferry, Crete floods), illness (brain-eating amoeba, raw-milk E. coli,
  skin cancer), animals and phobias (tick on a TV presenter, cormorant hunting, an 11-photo funny
  animal gallery), a botched execution, and 4 ordinary items (weather, rally, research, dance show).
  18 have photos, 55 photos in total (max 8 sent per article, 768 px JPEG).
- **Models**: `claude-haiku-4-5`, `claude-sonnet-5` (current default), `claude-sonnet-5-5`,
  `claude-opus-5-5` (reference). Every model ran twice on identical inputs (`#2` = second run), 4
  calls in parallel per model. The worker was classifying in the background with `claude-sonnet-5`
  at the same time, so latencies include ordinary proxy load.
- **Metrics** (tags compared per article, micro-averaged over all tags):
  - *tag precision / recall*: tag keys vs. the reference run (`claude-opus-5-5`, run 1).
  - *exact intensity*: share of tags both found with the same intensity.
  - *under-call rate*: share of reference tags the model missed or gave a lower intensity. This is the
    safety-relevant error: a reader who hides that tag would see the article. *Of which absent*: the
    tag was missing entirely.
  - *under-call vs stable ref*: the same against the 83 tags both reference runs agreed on (at the
    lower of their two intensities). This removes the reference model's own run-to-run noise; the
    reference rows are 0 % by construction.
  - *over-call rate*: model tags absent from the reference or at a higher intensity (hides more than
    needed; acceptable direction).
  - *primary topic* agreement and *importance MAD* (mean absolute difference, 1-5 scale).

## Results

| Run | ok/fail | p50 s | p90 s | in tok (mean) | out tok (mean) | cached (mean) | tag precision | tag recall | exact intensity | under-call rate | of which absent | under-call vs stable ref | over-call rate | primary topic | importance MAD |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| claude-haiku-4-5 | 20/0 | 4.0 | 7.1 | 2554 | 285 | 3833 | 75 % | 52 % | 52 % | 57 % | 48 % | 54 % | 48 % | 70 % | 0.45 |
| claude-haiku-4-5#2 | 20/0 | 4.1 | 4.7 | 2554 | 270 | 4791 | 80 % | 54 % | 65 % | 52 % | 46 % | 48 % | 40 % | 75 % | 0.55 |
| claude-sonnet-5 | 20/0 | 8.0 | 18.2 | 2933 | 936 | 6633 | 89 % | 64 % | 67 % | 48 % | 36 % | 42 % | 23 % | 85 % | 0.25 |
| claude-sonnet-5#2 | 20/0 | 9.8 | 19.6 | 2933 | 1034 | 6633 | 87 % | 66 % | 64 % | 47 % | 34 % | 40 % | 26 % | 85 % | 0.30 |
| claude-sonnet-5-5 | 20/0 | 3.9 | 4.9 | 2935 | 451 | 5306 | 84 % | 80 % | 80 % | 30 % | 20 % | 25 % | 22 % | 80 % | 0.25 |
| claude-sonnet-5-5#2 | 20/0 | 3.9 | 4.9 | 2935 | 460 | 6633 | 81 % | 82 % | 82 % | 28 % | 18 % | 23 % | 23 % | 80 % | 0.25 |
| claude-opus-5-5 (reference) | 20/0 | 5.7 | 7.0 | 2935 | 474 | 5306 | 100 % | 100 % | 100 % | 0 % | 0 % | 0 % | 0 % | 100 % | 0.00 |
| claude-opus-5-5#2 | 20/0 | 5.4 | 7.6 | 2935 | 467 | 6633 | 92 % | 93 % | 90 % | 11 % | 7 % | 0 % | 12 % | 90 % | 0.00 |

No call failed (160/160 valid structured outputs). "Cached" is the prompt-cache read of the shared
system prompt (taxonomy and rules); haiku tokenises differently, hence its smaller counts. The
worker's production calls with `claude-sonnet-5` (576 calls so far, 1 failed and retried) agree with
the benchmark: p50 5.7 s, p90 13.6 s, on average 2 741 input + 6 587 cached input + 610 output tokens
per article.

The second reference run is the noise floor: Opus disagrees with itself on 11 % of its tags, mostly
single `mention` tags that appear in one run only (`mental-health-crisis`, `terror-mass-casualty`,
`child-abuse`, `weapons-shooting`) and one-step intensity differences.

### Observations per article

- **Photos**: on the 11-photo animal gallery only Opus (`snakes-reptiles:1`, both runs) and Sonnet 5.5
  (`insects-arachnids:1`, both runs) flagged a phobia animal from the photos; Haiku and Sonnet 5 gave
  no phobia tag. This is the cheerful-spider case the design exists for.
- **Murder trial (9 photos)**: all models found the core tags; Opus and Sonnet 5.5 rated
  `true-crime-detail` graphic, Sonnet 5 and Haiku only description.
- **Raw-milk E. coli** (toddler nearly died): Haiku's summary says two children *died* (false), and it
  tagged `death-of-child:2`. Sonnet 5 missed `needles-medical-anxiety` (dialysis) that both Opus runs
  and both Sonnet 5.5 runs found.

### Calm headlines and summaries (eyeballed on all 20, quoted for five)

- **Murder trial**, original *"Nainen nauhoitti karmivan kehuskelun – Pohjalaismies tunnusti: ”Mä sanoin
  hyvää yötä”"*. Haiku: "Kahta miestä syytetään henkirikoksesta Seinäjoella". Sonnet 5: "Pohjalaismies
  kertoi humalassa tappaneensa toisen miehen – murhaoikeudenkäynti käynnissä" and a summary saying
  the body was found **dismembered**
  ("paloiteltuna"), the kind of specific the prompt asks to leave out. Sonnet 5.5: "Seinäjoen
  kellarimurhan oikeudenkäynti: syytetty myönsi puhuneensa humalassa teosta, mutta kiistää
  syyllisyytensä" (no gory detail). Opus: "Seinäjoen henkirikosoikeudenkäynti: syyttäjän näyttönä
  naisen tekemä äänite syytetyn puheista" (calmest).
- **Kyiv strikes**, original *"Zelenskyi jakoi hyytävän videon: Tällaisen iskun Putin järjesti…"*: all
  four removed "hyytävän"; all accurate.
- **Amoeba**, original *"Aivoja syövä ameeba tunkeutuu nenästä sisään – vaarallisesta iljetyksestä…"*:
  Haiku and Sonnet 5 kept "aivoja syövän"/"aivoihin tunkeutuva"; Sonnet 5.5 "Aivotulehdusta
  aiheuttavasta ameebasta saatiin uutta tietoa"; Opus "Tutkimus selvitti, miksi Naegleria fowleri
  -ameeba etenee tehokkaasti".
- **Tick on TV**, original *"Kiihtynyt Pekka Pouta vilautti paljasta pintaa suorassa lähetyksessä –
  katso video"*: Haiku's Finnish is broken ("paljaastaan pulahtanutta punkista johtuvia jälkiä");
  Sonnet 5.5 kept a "– katso video" tail; Sonnet 5 and Opus clean.
- **Crete floods** (a Finnish article): Sonnet 5 wrote the calm headline and summary in **English**
  ("Emergency declared in Crete as heavy rains cause severe flooding"); the other three wrote Finnish.

Across the 20: Haiku has factual or language errors in 7 summaries (children "died" in the raw-milk
story, garbled Finnish in the tick, flood, ferry, Tokyo-rain, child-abuse and skin-cancer items); Sonnet 5
is accurate but once answered in the wrong language and keeps distressing specifics (the dismembered
body; "13-vuotiaan raiskauksesta, joka johti raskauteen" where Sonnet 5.5 and Opus wrote
"seksuaalirikoksesta"); Sonnet 5.5 and Opus are consistently calm, accurate and in Finnish.

## Recommendation

**Switch `LLM_MODEL` to `claude-sonnet-5-5`.** Not applied; the default in `llm.ts` is still
`claude-sonnet-5`.

- It is the fastest model measured (p50 3.9 s, p90 4.9 s; the current default is 8-10 s / 18-20 s
  because it writes twice as many output tokens).
- On the safety-relevant error it is far closer to the reference: 23-25 % under-calls against the
  stable reference vs. 40-42 % for the current `claude-sonnet-5` and 48-54 % for Haiku (28-30 %,
  47-48 % and 52-57 % against the single reference run).
- It assessed photos better than Sonnet 5 and Haiku, and its calm headlines and summaries match Opus
  in quality.
- Haiku is ruled out: it is no faster than Sonnet 5.5, misses about half the reference tags, and wrote
  a false summary.

**Alternative if the token budget allows:** `claude-opus-5-5` itself. It is only ~1.5 s slower than
Sonnet 5.5 (p50 5.5 s, p90 7.3 s, still faster than the current default) and with the same token
counts, so the choice comes down to the per-token price difference, which this benchmark did not
measure. Its own run-to-run under-call rate (11 %, 0 % on stable tags) is the best achievable here.
Note that every agreement number above is measured against Opus, which favours Opus by construction.

## Not done

- Iltalehti's `source_meta.sentiment` was not passed as a hint: there is no measurement showing that
  it helps, and the classifier already sees the full text and photos.
- 20 articles is a small sample; percentages move by about 5 points between identical runs. Re-run
  after any prompt change (`PROMPT_VERSION`) with `--ids` of the same articles to compare.
