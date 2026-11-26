import fs from "fs";
import path from "path";
import crypto from "crypto";
import picomatch from "picomatch";
import { createSkipCheck } from "./skip.js";
import { newTranscription } from "./store.js";

/** Relative paths of all regular files under root (unreadable folders are left out). */
function walk(root, rel = "", out = []) {
  let entries;
  try {
    entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
  } catch (e) {
    return out;
  }
  for (const e of entries) {
    const r = rel ? path.join(rel, e.name) : e.name;
    if (e.isDirectory()) walk(root, r, out);
    else if (e.isFile()) out.push(r);
  }
  return out;
}

/**
 * Recordings that could be transcribed but never were: ones Zoomer downloaded itself, plus media
 * files found under transcription.backlog.dirs. Anything the skip check rejects is reported, not queued.
 * -> { candidates: [{ path, size, mtimeMs, rec? }], skipped: [{ path, reason }] }
 */
export function findBacklog({ cfg, db, skip = createSkipCheck(cfg) }) {
  const t = cfg.transcription;
  const b = t.backlog;
  const exts = new Set(t.mediaExtensions.map((e) => `.${e.toLowerCase()}`));
  const seen = new Set(db.data.recordings.filter((r) => r.path).map((r) => path.resolve(r.path)));
  const candidates = [];
  const skipped = [];
  const consider = (item) => {
    const reason = skip(item.path);
    if (reason) skipped.push({ path: item.path, reason });
    else candidates.push(item);
  };

  for (const rec of db.data.recordings) {
    if (rec.status !== "done" || !rec.path || rec.transcription || !fs.existsSync(rec.path)) continue;
    const st = fs.statSync(rec.path);
    consider({ path: rec.path, size: st.size, mtimeMs: st.mtimeMs, rec });
  }

  const include = picomatch(b.include);
  const exclude = b.exclude.length ? picomatch(b.exclude, { dot: true }) : () => false;
  for (const root of b.dirs.length ? b.dirs : [cfg.download.dir]) {
    for (const rel of walk(root)) {
      if (!exts.has(path.extname(rel).toLowerCase()) || !include(rel) || exclude(rel)) continue;
      const abs = path.resolve(root, rel);
      if (seen.has(abs)) continue;
      seen.add(abs);
      const st = fs.statSync(abs);
      if (st.size < b.minBytes) continue;
      consider({ path: abs, size: st.size, mtimeMs: st.mtimeMs });
    }
  }

  const dir = b.order === "oldest" ? 1 : -1;
  candidates.sort((x, y) => dir * (x.mtimeMs - y.mtimeMs));
  return { candidates, skipped };
}

/** Queue transcription for backlog items; files Zoomer did not download get a recording entry. */
export function queueBacklog({ db, items, now = Date.now }) {
  for (const item of items) {
    if (item.rec) {
      item.rec.transcription = newTranscription();
      continue;
    }
    db.data.recordings.push({
      id: `file-${crypto.createHash("sha1").update(item.path).digest("hex").slice(0, 16)}`,
      topic: path.basename(path.dirname(item.path)),
      path: item.path,
      size: item.size,
      bytes: item.size,
      status: "done",
      attempts: 0,
      source: "backlog",
      createdAt: new Date(now()).toISOString(),
      transcription: newTranscription(),
    });
  }
  db.save();
}
