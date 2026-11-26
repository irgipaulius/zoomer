// Zoomer configuration. Every key and its default lives here.
//
// Usage: cp config.example.js config.js, then set what you need in config.js.
// config.js only needs the keys you change; it is deep-merged over this file
// and is gitignored (it holds secrets). To keep it elsewhere, set
// ZOOMER_CONFIG=/path/to/zoomer.config.mjs (use .mjs outside this folder).
//
// Any key can also be set by environment variable: ZOOMER_ + the key path in
// UPPER_SNAKE_CASE, e.g. zoom.clientSecret -> ZOOMER_ZOOM_CLIENT_SECRET,
// download.concurrency -> ZOOMER_DOWNLOAD_CONCURRENCY. Lists are comma
// separated (ZOOMER_API_TOKENS=a,b). Env beats config.js beats this file.
export default {
  zoom: {
    // Server-to-Server OAuth app (marketplace.zoom.us) allowed to read cloud recordings
    accountId: "",
    clientId: "",
    clientSecret: "",
    userId: "me", // whose recordings to list
    oauthUrl: "https://zoom.us/oauth/token",
    apiUrl: "https://api.zoom.us/v2",
    lookbackDays: 0, // 0 = Zoom's default window; 1-30 = list the last N days
    pageSize: 300, // Zoom maximum
    requestTimeoutMs: 30000,
    tokenRefreshMarginMs: 300000, // refresh the 1h token this long before it expires
    // Which file to download per meeting: first available, completed type wins
    fileTypePreference: ["shared_screen_with_gallery_view", "gallery_view", "active_speaker", "audio_only"],
  },

  schedule: {
    cron: "*/5 * * * *", // when to check Zoom (croner syntax, optional seconds field)
    timezone: "", // e.g. "Europe/Berlin"; empty = system time zone
    runOnStart: true, // also run once right after start
  },

  download: {
    dir: "", // required: where recordings are saved
    // Path under dir. Placeholders: {topic} {date} {n} {ext} {id} {type}.
    // {n} = 1 + number of entries already in that folder (lesson counter).
    pathTemplate: "{topic}/{date} {topic} {n}/{date}_zoom_{n}.{ext}",
    dateFormat: "YYYY-MM-DD", // dayjs format for {date}
    concurrency: 2, // parallel downloads
    maxAttempts: 5, // scheduled runs a file may fail in before it is given up
    retries: 2, // quick retries inside one run, with exponential backoff:
    retryMinTimeoutMs: 10000,
    retryMaxTimeoutMs: 120000,
    retryFactor: 2,
    idleTimeoutMs: 120000, // no data for this long -> fail
    timeoutMs: 14400000, // whole-file limit (4 h)
    verifySize: true, // compare with the size Zoom reports
  },

  db: {
    path: "database/recordingsList.json", // relative paths are relative to the zoomer folder
    staleLockMs: 60000, // single-instance lock is considered dead after this long without update
  },

  log: {
    level: "info", // debug | info | warn | error
  },

  // Optional: after a download, queue a "transcribe" job for external workers
  // (see docs/WORKER_PROTOCOL.md). Needs api.enabled so workers can pull it.
  transcription: {
    enabled: false,
    language: null, // e.g. "lt"; null = let the worker detect
    models: "default", // "default" | "all" | ["model-a", "model-b"]
    formats: ["txt", "srt", "vtt", "json"],
    maxAttempts: 3,
    leaseSeconds: 600, // worker must heartbeat within this
    // Where results go. Placeholders: {dir} {name} (recording file name) {base}
    // (name without extension) {model} {format} {language}. Existing files are never
    // overwritten: a free name like "x.1.txt" is used instead.
    pathTemplate: "{dir}/{base}.{model}.{format}",
    // Used instead when the recording's folder holds other media files too (see
    // mediaExtensions), e.g. "{dir}/{name}.{model}.{format}". Empty = always pathTemplate.
    sharedFolderPathTemplate: "",
    mediaExtensions: ["mp4", "m4a", "mp3", "wav", "wma", "ogg", "oga", "opus", "flac", "aac", "amr", "webm", "mkv", "mov", "avi", "3gp"],

    // Never transcribe a recording twice. A recording is skipped (when it would be queued,
    // and again when a worker claims it) if any of these exist. Paths are relative to the
    // recording's folder unless absolute; placeholders {dir} {name} {base}; * ? [] wildcards
    // in the last segment. Files matching pathTemplate (or sharedFolderPathTemplate) always count.
    skipIfExists: [],
    // Optional text file of paths (one per line, # comments) to leave alone, e.g. recordings
    // another tool transcribes. A recording at or under a listed path is skipped.
    // Relative lines are relative to the file's folder.
    skipListFile: "",

    // "node index.js transcribe-backlog" also queues media already on disk: it scans these
    // folders (empty = download.dir) for files with mediaExtensions, filtered by globs
    // relative to the scanned folder.
    backlog: {
      dirs: [],
      include: ["**"],
      exclude: [],
      minBytes: 1000000, // ignore smaller files
      order: "newest", // newest | oldest (file modification time)
    },
  },

  // Worker HTTP API (pull-only; Zoomer never calls workers). Put HTTPS in front.
  api: {
    enabled: false,
    host: "127.0.0.1",
    port: 8787,
    basePath: "/api/v1",
    publicUrl: "", // how workers reach this API, e.g. https://zoomer.example.com; empty = http://host:port
    tokens: [], // accepted worker bearer tokens (set via ZOOMER_API_TOKENS)
    bodyLimit: "50mb", // max size of a results upload
  },
};
