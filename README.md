# zoomer

Self-hosted Zoom cloud recording downloader, with optional pluggable transcription.

Zoomer checks your Zoom account on a schedule, downloads every new cloud
recording into a folder structure you choose, and keeps track of what it has
fetched. Optionally it queues each recording for transcription. Transcription
workers run wherever you like (a GPU box, a cloud VM, your laptop): they
**pull** jobs from Zoomer over a small HTTP API and send the transcripts back,
which Zoomer saves next to the recording. Zoomer never connects out to them.

* One long-running process with a built-in cron-style schedule, or `--once` for system cron
* Downloads are verified: written to `.part`, size checked, then renamed
* Retries with backoff, per-file attempt limits, concurrency limit, timeouts
* Crash-safe JSON database (atomic writes), single-instance guard
* Everything configurable in one file or via environment variables
* Pure JavaScript, Node.js 15.14 or newer, no database server

## Quick start

1. Create a **Server-to-Server OAuth** app at marketplace.zoom.us with permission
   to read cloud recordings. Note the account ID, client ID and client secret.
2. Install:

   ```console
   git clone https://github.com/irgipaulius/zoomer.git
   cd zoomer
   npm install
   cp config.example.js config.js   # then set zoom.* and download.dir
   node index.js init               # creates the empty database
   node index.js                    # runs on the schedule; Ctrl-C to stop
   ```

3. Keep it running with your service manager (systemd, rc.d, pm2, a container,
   ...), pointing it at `node /path/to/zoomer/index.js`. Or skip the built-in
   schedule and use system cron:

   ```console
   */5 * * * * node /path/to/zoomer/index.js --once >> /path/to/zoomer/zoomer.log 2>&1
   ```

   A second instance (for example an overlapping cron run) sees the lock and exits.

## Commands

| Command | What it does |
|---|---|
| `node index.js` | Run on `schedule.cron` until stopped (SIGINT/SIGTERM stop it cleanly) |
| `node index.js --once` | One pass (list, download everything due), then exit. The worker API is not started |
| `node index.js status` | Counts, plus every download or transcription that is not done, with its last error |
| `node index.js retry <id>` | Re-queue a failed download or transcription (stop the running instance first) |
| `node index.js init` | Create an empty database (fresh installs) |
| `node index.js transcribe-backlog [--limit N] [--dry-run] [--verbose]` | Queue transcription for recordings that have none yet (stop the running instance first) |
| `npm test` | Tests; fake Zoom and fake worker, no network |

## Configuration

`config.example.js` holds every setting with its default and a comment. Your
`config.js` only needs what you change; it is merged over the defaults.
Both `config.js` and the database are gitignored.

Every key can also come from the environment: `ZOOMER_` plus the key path in
UPPER_SNAKE_CASE, e.g. `zoom.clientSecret` → `ZOOMER_ZOOM_CLIENT_SECRET`.
Lists are comma separated. Precedence: environment > `config.js` > defaults.
`ZOOMER_CONFIG` points to a config file elsewhere (use a `.mjs` name there).

| Key | Default | Meaning |
|---|---|---|
| `zoom.accountId`, `zoom.clientId`, `zoom.clientSecret` | `""` | S2S OAuth credentials (required) |
| `zoom.userId` | `"me"` | Whose recordings to list |
| `zoom.oauthUrl`, `zoom.apiUrl` | Zoom's | API endpoints |
| `zoom.lookbackDays` | `0` | 0 = Zoom's default window; 1–30 = list the last N days (catches up after downtime) |
| `zoom.pageSize` | `300` | Listing page size |
| `zoom.requestTimeoutMs` | `30000` | Zoom API request timeout |
| `zoom.tokenRefreshMarginMs` | `300000` | Refresh the access token this long before it expires |
| `zoom.fileTypePreference` | screen+gallery, gallery, speaker, audio | Which file to fetch per meeting: first completed match wins |
| `schedule.cron` | `"*/5 * * * *"` | When to check Zoom (cron syntax, optional seconds field) |
| `schedule.timezone` | `""` | IANA zone for the schedule; empty = system zone |
| `schedule.runOnStart` | `true` | Also run immediately at start |
| `download.dir` | `""` | Where recordings go (required) |
| `download.pathTemplate` | `"{topic}/{date} {topic} {n}/{date}_zoom_{n}.{ext}"` | Path under `dir`; placeholders `{topic} {date} {n} {ext} {id} {type}`; `{n}` = 1 + entries already in that folder |
| `download.dateFormat` | `"YYYY-MM-DD"` | dayjs format for `{date}` |
| `download.concurrency` | `2` | Parallel downloads |
| `download.maxAttempts` | `5` | Scheduled runs a file may fail in before it is given up |
| `download.retries` | `2` | Quick retries within one run … |
| `download.retryMinTimeoutMs`, `retryMaxTimeoutMs`, `retryFactor` | `10000`, `120000`, `2` | … with exponential backoff |
| `download.idleTimeoutMs` | `120000` | Fail if no data arrives for this long |
| `download.timeoutMs` | `14400000` | Whole-file time limit (4 h) |
| `download.verifySize` | `true` | Compare with the size Zoom reports |
| `db.path` | `"database/recordingsList.json"` | Database file; relative to the zoomer folder |
| `db.staleLockMs` | `60000` | Single-instance lock counts as dead after this long without refresh |
| `log.level` | `"info"` | `debug`, `info`, `warn`, `error` |
| `transcription.enabled` | `false` | Queue a transcribe job after each download |
| `transcription.language` | `null` | Language to request (null = worker detects); workers whose `capabilities.languages` lack it are not given the job |
| `transcription.models` | `"default"` | `"default"`, `"all"`, or a list of model names |
| `transcription.formats` | `["txt","srt","vtt","json"]` | Which result formats to save |
| `transcription.maxAttempts` | `3` | Claims (incl. expired leases) before giving up |
| `transcription.leaseSeconds` | `600` | Workers must heartbeat within this |
| `transcription.pathTemplate` | `"{dir}/{base}.{model}.{format}"` | Where results go; `{dir} {base} {model} {format} {language}` |
| `api.enabled` | `false` | Start the worker API (long-running mode only) |
| `api.host`, `api.port` | `"127.0.0.1"`, `8787` | Bind address |
| `api.basePath` | `"/api/v1"` | URL prefix |
| `api.publicUrl` | `""` | How workers reach the API (used in media links); empty = `http://host:port` |
| `api.tokens` | `[]` | Accepted worker bearer tokens (required when enabled) |
| `api.bodyLimit` | `"50mb"` | Largest accepted results upload |

## Transcription workers

With `transcription.enabled` and `api.enabled`, each finished download gets a
`transcribe` job. A worker loop looks like this:

1. `POST /api/v1/jobs/claim` → a job with a lease, or `204` when there is nothing to do
2. `GET` the job's `media.url` (HTTP Range supported), transcribe
3. `POST /jobs/{id}/heartbeat` while working, so the lease does not expire
4. `POST /jobs/{id}/results` once per model, then `POST /jobs/{id}/complete`
   (or `/fail` with `retryable`)

All calls except `/health` need `Authorization: Bearer <one of api.tokens>`.
Put HTTPS in front with a reverse proxy if workers connect over the internet.
Any program that speaks the protocol can be a worker. The full contract is in
[docs/WORKER_PROTOCOL.md](docs/WORKER_PROTOCOL.md).

### Never transcribing twice

A recording is not queued, and a queued job is dropped when a worker claims it, if
a transcript already exists next to it. Zoomer's own output (`transcription.pathTemplate`)
always counts; add the names other tools use with `transcription.skipIfExists`, e.g.
`["transcription_*.txt", "{name}.*.txt"]`, and list anything another tool is still
working on in `transcription.skipListFile` (one file or folder per line). Results never
overwrite an existing file; a free name such as `x.1.txt` is used instead.

### Older recordings

`node index.js transcribe-backlog --dry-run --verbose` lists recordings with no
transcript yet (newest first) and what it skips and why. Without `--dry-run` it queues
them (`--limit N`, default 10). Besides recordings Zoomer downloaded, it scans
`transcription.backlog.dirs` (default `download.dir`) for media files, filtered by the
`backlog.include` / `backlog.exclude` globs. Stop a running Zoomer before queueing.

## Data

`db.path` holds one entry per recording: its file path, download status
(`pending`, `done`, `failed`), attempts and last error, and, if enabled, a
`transcription` object (`pending`, `leased`, `done`, `failed`, models already
delivered, files written). It is written atomically and is plain JSON, so it is
easy to inspect or back up.

## Upgrading from 1.x

1.x was run from system cron, tracked `config.js` and `database/recordingsList.json`
in git, and used a flat config. Before pulling:

1. Stop the cron job and make sure no run is active.
2. Copy `config.js` and `database/recordingsList.json` somewhere outside the repo.
   Pulling deletes them from the working tree, or refuses to pull while they are modified.
3. Run `git checkout -- config.js database/recordingsList.json`, then pull, then `npm install`.
4. Copy the database back to `database/recordingsList.json` and convert it once:
   `node scripts/convert-db-v1-to-v2.js database/recordingsList.json`
   (keeps a `.v1.bak`; all old recordings are marked done).
5. Create the new `config.js` from `config.example.js`: old `ZOOM_S2S_ACC_ID`,
   `ZOOM_S2S_CLIENT_ID`, `ZOOM_S2S_SECRET` and `DESTINATION` become `zoom.accountId`,
   `zoom.clientId`, `zoom.clientSecret` and `download.dir`. `LOCATION` is no longer needed.
6. Run `node index.js status`, then start Zoomer as a service, or keep cron with `--once`.

## License

MIT
