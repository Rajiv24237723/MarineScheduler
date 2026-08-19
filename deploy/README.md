# Deploying the evaluation demo

Free end to end: Cloud Run scaling to zero, Neon Postgres on the free plan.

## Why these two

Evaluators need durable data and a shared view of it. Ruling the alternatives out:

- **PGlite on Cloud Run** — each container instance opens its own database file, so
  two instances diverge and one evaluator's published plan is invisible to another.
  Fine for local development, wrong for a shared demo.
- **Cloud SQL / AlloyDB** — no always-free tier. Cloud SQL offers a $300 / 90-day
  trial; AlloyDB's smallest configuration is around $100/month.
- **Supabase free** — projects pause after a week of inactivity and unpausing is a
  manual dashboard action. An evaluation that sits quiet over a weekend comes back
  dead, and you will not be watching. Preventable only with a keep-alive cron, which
  is another free-tier moving part that can fail silently.
- **Neon free** — compute autosuspends after five minutes and resumes on connect, so
  idle gaps cost nothing and need no babysitting. Its constraint is a **100 CU-hour
  monthly budget**; exceed it and, in Neon's words, "existing connections drop and
  new ones can't open" until the next billing period. That failure mode is
  preventable with configuration you control, which is why it wins.

## Protecting the CU-hour budget

Two settings, both already in `cloudrun.yaml`. Getting either wrong is the one way
to break this deployment:

1. **`minScale: 0`.** A warm instance holding a pool keeps the Neon compute awake:
   24h × 0.25 CU ≈ 6 CU-hours/day ≈ 180/month, over budget by mid-month.
   **Never set `minScale: 1` on a Neon free plan.**
2. **`DATABASE_IDLE_TIMEOUT_SEC=20`.** Without a short idle timeout, `postgres-js`
   keeps connections open after the last request and the compute never suspends.

The cost of `minScale: 0` is a cold start of a few seconds for the first evaluator
after an idle spell — Cloud Run boot plus a Neon resume.

## One-time setup

```bash
export PROJECT_ID=your-project REGION=us-central1
export IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/marine/scheduler:$(git rev-parse --short HEAD)"
```

Create a Neon project, then take **both** connection strings from its dashboard.
They differ by one substring — the pooled host carries `-pooler`:

```bash
# Pooled — app queries.
printf '%s' 'postgresql://USER:PASS@ep-xxx-pooler.REGION.aws.neon.tech/marine?sslmode=require' \
  | gcloud secrets create marine-database-url --data-file=- --project="$PROJECT_ID"

# Direct — migrations only.
printf '%s' 'postgresql://USER:PASS@ep-xxx.REGION.aws.neon.tech/marine?sslmode=require' \
  | gcloud secrets create marine-migration-database-url --data-file=- --project="$PROJECT_ID"
```

Grant the runtime service account access to both, then build and deploy:

```bash
gcloud builds submit --tag "$IMAGE" --project="$PROJECT_ID"

gcloud run deploy marine-scheduler \
  --image="$IMAGE" --region="$REGION" --project="$PROJECT_ID" \
  --allow-unauthenticated \
  --cpu=2 --memory=2Gi --concurrency=4 --timeout=900 \
  --min-instances=0 --max-instances=4 \
  --set-secrets=DATABASE_URL=marine-database-url:latest,MIGRATION_DATABASE_URL=marine-migration-database-url:latest \
  --set-env-vars=NODE_ENV=production,DATABASE_IDLE_TIMEOUT_SEC=20,DATABASE_CONNECT_TIMEOUT_SEC=15,DATABASE_POOL_MAX=3,SOLVE_TIME_LIMIT_SEC=120
```

## What happens on first boot

1. Migrations replay from `./drizzle` over the **direct** endpoint, then that
   connection closes so it cannot hold the compute awake.
2. Ledger triggers are installed — idempotent, so every boot is safe.
3. The seed runs **once**, guarded by a transaction-scoped advisory lock. Several
   instances cold-booting together cannot double-seed; the losers see a populated
   database and skip.

Subsequent boots skip the seed, which is what makes generated plan history persist.

## Reducing cold starts (optional, still free)

The first evaluator after an idle spell waits for two things: the container to boot,
and the Neon compute to resume. They cost very different amounts to remove.

**Never point a timer at `/api/health`.** It runs a real query, so a schedule or a
liveness probe hitting it keeps the compute permanently awake:

```
24/7 awake at the 0.25 CU floor = 730 h × 0.25 = 182 CU-hours/month
Neon free budget                                = 100 CU-hours
```

Past that, in Neon's words, "existing connections drop and new ones can't open"
until the next billing period. There is no way to buy your way out mid-month except
upgrading. This is why the liveness probe in `cloudrun.yaml` uses `/api/ping`.

### Warm the container — cheap, leave it on

`/api/ping` is liveness only and touches nothing. Warming with it removes the larger
half of the latency and leaves the database asleep.

```bash
gcloud scheduler jobs create http marine-warm-container \
  --project="$PROJECT_ID" --location="$REGION" \
  --schedule="*/5 * * * *" \
  --uri="$URL/api/ping" --http-method=GET
```

Cost against the always-free tier (2 M requests, 180,000 vCPU-s, 360,000 GiB-s):

| | Used | Allowance | Share |
|---|---|---|---|
| Requests | 8,760/mo | 2,000,000 | 0.4% |
| vCPU-seconds | 2 vCPU × 0.1 s × 8,760 = 1,752 | 180,000 | 1% |
| GiB-seconds | 2 GiB × 0.1 s × 8,760 = 1,752 | 360,000 | 0.5% |

With CPU throttling on — which `cloudrun.yaml` sets — you are billed only while a
request is being served, so a warm-but-idle instance between pings costs nothing.

### Warm the database too — only during evaluation hours

This one spends CU-hours, so bound it to when evaluators are actually around. Neon's
own figure is ~400 awake hours per month at the 0.25 CU floor.

```bash
# 09:00–18:00 Mon–Fri, every 4 minutes (inside Neon's 5-minute autosuspend window)
gcloud scheduler jobs create http marine-warm-db \
  --project="$PROJECT_ID" --location="$REGION" \
  --schedule="*/4 9-17 * * 1-5" --time-zone="Asia/Kolkata" \
  --uri="$URL/api/health" --http-method=GET
```

| Schedule | Awake hours | CU-hours | Verdict |
|---|---|---|---|
| 24/7 | 730 | 182 | locked out mid-month |
| 09:00–18:00 weekdays | 189 | ~47 | comfortable |
| 08:00–20:00 weekdays | 252 | ~63 | fine |

The figures assume the compute stays near the floor. Neon scales to 2 CU under load,
so busy evaluation days burn faster than the table implies — the headroom absorbs it,
but 400 hours is not a guarantee. Delete this job when the evaluation ends.

Cloud Scheduler allows **3 free jobs per billing account**; these two fit.

### What this does not fix

Cloud Run gives no guarantee about how long an idle instance survives, so warming
reduces cold starts rather than eliminating them. And a ping keeps *one* instance
warm — with `maxScale: 4`, two evaluators arriving together may still meet a cold
start on a second instance. Removing that needs `min-instances`, which bills and
would hold the database awake, so it is the one place where free and instant
genuinely conflict.

Startup is resilient regardless: `waitForDb()` retries with backoff (250 ms → 4 s)
so a container that boots while the compute is still waking waits rather than dying
in migrations or serving errors.

## Verifying

```bash
curl -s "$URL/api/ping"                        # liveness only — no database
curl -s "$URL/api/health"                      # runs a real query; wakes a suspended compute
curl -s "$URL/api/ledger/verify?stream=POL"    # sealed months verify
curl -s "$URL/api/dashboard?stream=POL" | head -c 200
```

The split is the point. `/api/health` runs a real `select 1`, because a health check
that never queries says nothing about whether the app can serve a request — but that
also makes it unsuitable for anything on a short timer. `/api/ping` exists for timers.

## Local development is unaffected

No `DATABASE_URL` means PGlite in-process — clone, `npm install`, `npm run dev`. No
account, no service, no container. The deployed instance is the only thing that
needs Neon.

## Notes

- **Storage.** Neon free gives 0.5 GB. Version rows carry the full solve result and
  the inventory projection as JSONB, roughly a few hundred KB each — over a thousand
  versions before it matters. Scenario runs create three draft candidates apiece, so
  it grows faster than version numbers suggest; discard drafts you do not need.
- **Reset.** Settings → Data administration wipes every stream for everyone using
  the instance. It is the right escape hatch for evaluators trying combinations, but
  it is not per-session.
- **Seeded history.** Apr–Jun 2026 are illustrative, marked as such in the UI and
  documented in `docs/DATA_PROVENANCE.md`.
