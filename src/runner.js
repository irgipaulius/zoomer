import fs from "fs";
import path from "path";
import pQueue from "p-queue";
import pRetry from "p-retry";
import { recordingPath } from "./paths.js";
import { downloadFile } from "./download.js";
import { newTranscription } from "./store.js";
import { createSkipCheck } from "./skip.js";

/** One scheduled pass = list Zoom, queue new recordings, download what is pending. */
export function createRunner({ cfg, db, zoom, log, download = downloadFile, now = Date.now, skip = createSkipCheck(cfg) }) {
  const d = cfg.download;
  const queue = new (pQueue.default || pQueue)({ concurrency: d.concurrency });
  const inFlight = new Set();
  const iso = () => new Date(now()).toISOString();

  async function enqueueNew() {
    const found = await zoom.listRecordings();
    const fresh = found.filter((r) => !db.get(r.id));
    for (const r of fresh) {
      const p = recordingPath(cfg, r);
      fs.mkdirSync(path.dirname(p), { recursive: true }); // reserves the {n} folder
      db.data.recordings.push({ ...r, path: p, status: "pending", attempts: 0, createdAt: iso() });
      log.info(`queued ${r.id} "${r.topic}" -> ${p}`);
    }
    if (fresh.length) db.save();
    log.info(`zoom: ${found.length} recordings listed, ${fresh.length} new`);
  }

  function queueTranscription(rec) {
    let why;
    try {
      why = skip(rec.path);
    } catch (e) {
      why = `skip check failed: ${e.message}`; // never risk transcribing twice
    }
    if (why) {
      rec.transcription = { status: "skipped", reason: why };
      log.info(`not transcribing ${rec.id}: ${why}`);
    } else {
      rec.transcription = newTranscription();
      log.info(`queued transcription for ${rec.id}`);
    }
  }

  async function downloadOne(rec) {
    const attempt = () =>
      zoom.getToken().then((token) =>
        download({ url: rec.url, dest: rec.path, token, size: d.verifySize ? rec.size : null, idleTimeoutMs: d.idleTimeoutMs, timeoutMs: d.timeoutMs })
      );
    log.info(`downloading ${rec.id} (attempt ${rec.attempts + 1}/${d.maxAttempts})`);
    try {
      rec.bytes = await pRetry(attempt, {
        retries: d.retries,
        factor: d.retryFactor,
        minTimeout: d.retryMinTimeoutMs,
        maxTimeout: d.retryMaxTimeoutMs,
        onFailedAttempt: (e) => log.warn(`${rec.id}: ${e.message} (${e.retriesLeft} quick retries left)`),
      });
      Object.assign(rec, { status: "done", error: null, doneAt: iso() });
      log.info(`downloaded ${rec.id}: ${rec.bytes} bytes -> ${rec.path}`);
      if (cfg.transcription.enabled) queueTranscription(rec);
    } catch (e) {
      rec.attempts++;
      rec.error = e.message;
      if (rec.attempts >= d.maxAttempts) rec.status = "failed";
      log.error(`${rec.id} failed (${rec.attempts}/${d.maxAttempts}${rec.status === "failed" ? ", giving up" : ""}): ${e.message}`);
    }
    db.save();
  }

  async function tick() {
    try {
      await enqueueNew();
    } catch (e) {
      log.error(`listing Zoom recordings failed: ${e.message}`);
    }
    for (const rec of db.data.recordings) {
      if (rec.status !== "pending" || inFlight.has(rec.id)) continue;
      inFlight.add(rec.id);
      queue.add(() => downloadOne(rec)).finally(() => inFlight.delete(rec.id));
    }
  }

  return { tick, queue, idle: () => queue.onIdle() };
}
