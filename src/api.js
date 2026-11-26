import fs from "fs";
import path from "path";
import crypto from "crypto";
import express from "express";
import writeFileAtomic from "write-file-atomic";
import { transcriptPath } from "./paths.js";
import { createSkipCheck } from "./skip.js";

export const PROTOCOL_VERSION = 1;

/** Worker pull API (docs/WORKER_PROTOCOL.md). Transcription state lives on each recording. */
export function createApi({ cfg, db, log, now = Date.now, skip = createSkipCheck(cfg) }) {
  const t = cfg.transcription;
  const a = cfg.api;
  const iso = (ms) => new Date(ms).toISOString();
  const jobs = (status) => db.data.recordings.filter((r) => r.transcription && r.transcription.status === status);
  const giveUpOr = (job, status) => (job.attempts >= t.maxAttempts ? "failed" : status);

  function expireLeases() {
    for (const rec of jobs("leased")) {
      const job = rec.transcription;
      if (Date.parse(job.leaseExpiresAt) > now()) continue;
      Object.assign(job, { status: giveUpOr(job, "pending"), error: "lease expired", leaseId: null });
      log.warn(`transcription lease expired for ${rec.id} (${job.status})`);
      db.save();
    }
  }

  /** The recording whose lease the request holds, or null after answering 409. */
  function leased(req, res) {
    expireLeases();
    const rec = db.get(req.params.id);
    const job = rec && rec.transcription;
    if (job && job.status === "leased" && job.leaseId === (req.body || {}).lease_id) return rec;
    res.status(409).json({ error: "lease lost" });
    return null;
  }

  const app = express();
  const r = express.Router();
  r.get("/health", (req, res) => res.json({ ok: true, version: PROTOCOL_VERSION }));
  r.use((req, res, next) => {
    const token = String(req.headers.authorization || "").replace(/^Bearer /, "");
    return a.tokens.includes(token) ? next() : res.status(401).json({ error: "unauthorized" });
  });
  r.use(express.json({ limit: a.bodyLimit }));

  r.post("/jobs/claim", (req, res) => {
    const { worker_id: workerId, types = ["transcribe"], capabilities = {} } = req.body || {};
    expireLeases();
    const langs = capabilities.languages;
    const fits = () => types.includes("transcribe") && (!t.language || !langs || langs.includes(t.language));
    let rec = null;
    for (const r of fits() ? jobs("pending") : []) {
      let why;
      try {
        why = skip(r.path, r.transcription.files || []); // a transcript may have appeared since it was queued
      } catch (e) {
        log.error(`skip check failed, not handing out jobs: ${e.message}`);
        return res.status(503).json({ error: "skip check failed" });
      }
      if (!why) {
        rec = r;
        break;
      }
      Object.assign(r.transcription, { status: "skipped", reason: why });
      log.info(`transcription ${r.id} skipped: ${why}`);
      db.save();
    }
    if (!rec) return res.status(204).end();
    const job = rec.transcription;
    Object.assign(job, { status: "leased", attempts: job.attempts + 1, leaseId: crypto.randomUUID(), leaseExpiresAt: iso(now() + t.leaseSeconds * 1000), workerId });
    db.save();
    log.info(`transcription ${rec.id} claimed by ${workerId} (attempt ${job.attempts}/${t.maxAttempts})`);
    res.json({
      id: rec.id,
      type: "transcribe",
      lease_id: job.leaseId,
      lease_expires_at: job.leaseExpiresAt,
      recording: { id: rec.id, topic: rec.topic, start_time: rec.startTime || null, duration_s: rec.durationS || null },
      media: {
        url: `${a.publicUrl || `http://${a.host}:${a.port}`}${a.basePath}/jobs/${encodeURIComponent(rec.id)}/media`,
        filename: path.basename(rec.path),
        size: rec.bytes || rec.size || null,
        content_type: express.static.mime.lookup(rec.path),
      },
      options: { language: t.language, models: t.models, formats: t.formats },
      done_models: job.doneModels,
    });
  });

  r.post("/jobs/:id/heartbeat", (req, res) => {
    const rec = leased(req, res);
    if (!rec) return;
    rec.transcription.leaseExpiresAt = iso(now() + t.leaseSeconds * 1000);
    db.save();
    res.json({ lease_expires_at: rec.transcription.leaseExpiresAt });
  });

  r.get("/jobs/:id/media", (req, res) => {
    const rec = db.get(req.params.id);
    if (!rec || !rec.transcription || rec.status !== "done") return res.status(404).json({ error: "no such job" });
    res.sendFile(rec.path); // handles Range
  });

  r.post("/jobs/:id/results", (req, res) => {
    const rec = leased(req, res);
    if (!rec) return;
    const { lease_id: _lease, ...body } = req.body;
    if (!body.model) return res.status(400).json({ error: "model is required" });
    const content = { txt: body.text, srt: body.srt, vtt: body.vtt, json: JSON.stringify(body, undefined, " ") };
    const job = rec.transcription;
    const files = [];
    for (const format of t.formats) {
      if (content[format] == null) continue;
      const file = transcriptPath(cfg, rec, body.model, format, body.language);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      writeFileAtomic.sync(file, content[format]);
      files.push(file);
    }
    job.files = [...new Set([...job.files, ...files])];
    if (!job.doneModels.includes(body.model)) job.doneModels.push(body.model);
    db.save();
    log.info(`transcription ${rec.id}: model ${body.model} saved (${files.length} files)`);
    res.json({ ok: true, files });
  });

  r.post("/jobs/:id/complete", (req, res) => {
    const rec = leased(req, res);
    if (!rec) return;
    Object.assign(rec.transcription, { status: "done", leaseId: null, error: null, doneAt: iso(now()) });
    db.save();
    log.info(`transcription ${rec.id} complete`);
    res.json({ ok: true });
  });

  r.post("/jobs/:id/fail", (req, res) => {
    const rec = leased(req, res);
    if (!rec) return;
    const job = rec.transcription;
    const status = req.body.retryable ? giveUpOr(job, "pending") : "failed";
    Object.assign(job, { status, leaseId: null, error: String(req.body.error || "unknown error") });
    db.save();
    log.warn(`transcription ${rec.id} failed (${status}): ${job.error}`);
    res.json({ ok: true });
  });

  app.use(a.basePath, r);
  return app;
}
