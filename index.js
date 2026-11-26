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

const USAGE = `usage: node index.js [command] [--once]
  run [--once]   (default) run on the configured schedule; --once = one pass, then exit (for system cron)
  status         show downloads and transcriptions that are not done
  retry <id>     re-queue a failed download or transcription (stop the running instance first)
  init           create an empty database (fresh installs only)`;

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

async function main(argv) {
  const cmd = argv.find((a) => !a.startsWith("--")) || "run";
  const cfg = await loadConfig(projectDir);
  const log = createLogger(cfg.log.level);

  if (cmd === "init") return initDb(cfg.db.path) && console.log(`created ${cfg.db.path}`);
  if (cmd === "status") return status(openDb(cfg.db.path));
  if (cmd !== "run" && cmd !== "retry") return console.error(USAGE), (process.exitCode = 2);

  if (cmd === "run") assertRunnable(cfg);
  const release = lock(cfg, log);
  if (!release) {
    if (cmd === "retry") throw new Error("zoomer is running; stop it first");
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
