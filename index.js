import path from "path";
import { fileURLToPath } from "url";
import Cron from "croner";
import lockfile from "proper-lockfile";

import { loadConfig, assertRunnable } from "./src/config.js";
import { createLogger } from "./src/log.js";
import { openDb, initDb } from "./src/store.js";
import { createZoomClient } from "./src/zoom.js";
import { createRunner } from "./src/runner.js";
import { createApi } from "./src/api.js";
import { findBacklog, queueBacklog } from "./src/backlog.js";

const USAGE = `usage: node index.js [command] [--once]
  run [--once]   (default) run on the configured schedule; --once = one pass, then exit (for system cron)
  status         show downloads and transcriptions that are not done
  retry <id>     re-queue a failed download or transcription (stop the running instance first)
  init           create an empty database (fresh installs only)
  transcribe-backlog [--limit N] [--dry-run] [--verbose]
                 queue transcription for recordings that have none yet (newest first, default
                 limit 10); --dry-run only lists them, --verbose also lists what is skipped and why`;

const projectDir = path.dirname(fileURLToPath(import.meta.url));

/** Single-instance guard: a lock on the db file, refreshed while we run. */
function lock(cfg, log) {
  try {
    return lockfile.lockSync(cfg.db.path, {
      stale: cfg.db.staleLockMs,
      onCompromised: (e) => log.error(`instance lock lost: ${e.message}`),
    });
  } catch (e) {
    if (e.code === "ELOCKED") return null;
    throw e;
  }
}

function status(db) {
  const recs = db.data.recordings;
  const count = (pick) => recs.reduce((c, r) => ((c[pick(r)] = (c[pick(r)] || 0) + 1), c), {});
  console.log("downloads:", JSON.stringify(count((r) => r.status)));
  console.log("transcriptions:", JSON.stringify(count((r) => (r.transcription ? r.transcription.status : "none"))));
  for (const r of recs) {
    const tr = r.transcription;
    if (r.status !== "done") console.log(`- download ${r.status} ${r.id} "${r.topic}" attempts ${r.attempts}${r.error ? ` | ${r.error}` : ""}`);
    if (tr && tr.status !== "done" && tr.status !== "skipped") console.log(`- transcription ${tr.status} ${r.id} "${r.topic}" attempts ${tr.attempts}${tr.error ? ` | ${tr.error}` : ""}`);
  }
}

function backlog(cfg, db, argv, dryRun) {
  const i = argv.indexOf("--limit");
  const limit = i >= 0 ? Number(argv[i + 1]) : 10;
  if (!(limit >= 0)) throw new Error("--limit needs a number");
  const { candidates, skipped } = findBacklog({ cfg, db });
  const pick = candidates.slice(0, limit);
  const mb = (n) => `${(n / 1e6).toFixed(0)} MB`;
  if (argv.includes("--verbose")) for (const s of skipped) console.log(`skip  ${s.path}\n      ${s.reason}`);
  for (const c of pick) console.log(`${dryRun ? "would queue" : "queued"}  ${new Date(c.mtimeMs).toISOString().slice(0, 10)}  ${mb(c.size)}  ${c.path}`);
  if (!dryRun) queueBacklog({ db, items: pick });
  console.log(`${candidates.length} untranscribed, ${skipped.length} skipped (already transcribed or listed); ${dryRun ? "would queue" : "queued"} ${pick.length}`);
}

async function main(argv) {
  const cmd = argv.find((a) => !a.startsWith("--")) || "run";
  const cfg = await loadConfig(projectDir);
  const log = createLogger(cfg.log.level);

  if (cmd === "init") return initDb(cfg.db.path) && console.log(`created ${cfg.db.path}`);
  if (cmd === "status") return status(openDb(cfg.db.path));
  if (cmd === "transcribe-backlog" && argv.includes("--dry-run")) return backlog(cfg, openDb(cfg.db.path), argv, true);
  if (!["run", "retry", "transcribe-backlog"].includes(cmd)) return console.error(USAGE), (process.exitCode = 2);
  if (cmd === "transcribe-backlog" && !cfg.transcription.enabled) throw new Error("transcription.enabled is off");

  if (cmd === "run") assertRunnable(cfg);
  const release = lock(cfg, log);
  if (!release) {
    if (cmd !== "run") throw new Error("zoomer is running; stop it first");
    return log.info("another zoomer instance is running; exiting");
  }
  const db = openDb(cfg.db.path);

  if (cmd === "retry") {
    const rec = db.get(argv[argv.indexOf("retry") + 1]);
    if (!rec) throw new Error("no such recording id");
    if (rec.status === "failed") Object.assign(rec, { status: "pending", attempts: 0 });
    if (rec.transcription && rec.transcription.status === "failed") Object.assign(rec.transcription, { status: "pending", attempts: 0 });
    db.save();
    release();
    return console.log(`re-queued ${rec.id}`);
  }

  if (cmd === "transcribe-backlog") {
    backlog(cfg, db, argv, false);
    return release();
  }

  const runner = createRunner({ cfg, db, zoom: createZoomClient(cfg.zoom), log });

  if (argv.includes("--once")) {
    await runner.tick();
    await runner.idle();
    return release();
  }

  const server = cfg.api.enabled && createApi({ cfg, db, log }).listen(cfg.api.port, cfg.api.host);
  if (server) log.info(`worker API on http://${cfg.api.host}:${cfg.api.port}${cfg.api.basePath}`);
  const job = Cron(cfg.schedule.cron, { timezone: cfg.schedule.timezone || undefined, protect: true }, runner.tick);
  log.info(`zoomer started, schedule "${cfg.schedule.cron}", next run ${job.next().toISOString()}`);
  if (cfg.schedule.runOnStart) runner.tick();

  const shutdown = (signal) => {
    log.info(`${signal}: stopping (unfinished downloads restart on the next start)`);
    job.stop();
    runner.queue.clear();
    if (server) server.close();
    db.save();
    release();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main(process.argv.slice(2)).catch((e) => {
  console.error(`${new Date().toISOString()} ERROR ${e.message}`);
  process.exit(1);
});
