import assert from "assert";
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { test } from "./harness.js";
import { testSetup } from "./setup.js";
import { findBacklog, queueBacklog } from "../src/backlog.js";
import { openDb } from "../src/store.js";

const put = (file, bytes = 10, ageDays = 0) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "x".repeat(bytes));
  const t = new Date(Date.parse("2026-01-10T00:00:00Z") - ageDays * 864e5);
  fs.utimesSync(file, t, t);
  return file;
};

function archive(extra = {}) {
  const s = testSetup({ transcription: { enabled: true, skipIfExists: ["transcription_*.txt"], backlog: { minBytes: 5, ...extra } } });
  const d = s.cfg.download.dir;
  const f = {
    done: put(`${d}/2025/L1/zoom_1.mp4`, 10, 30),
    fresh: put(`${d}/2025/L2/zoom_2.mp4`, 10, 1),
    old: put(`${d}/2024/L9/a.m4a`, 10, 300),
    tiny: put(`${d}/2025/L3/zoom_3.mp4`, 2),
    notMedia: put(`${d}/2025/L4/slides.pdf`),
    listed: put(`${d}/2023/Other/x.mp3`, 10, 400),
    excluded: put(`${d}/2025/L5/Audio Record/p1.m4a`),
  };
  fs.writeFileSync(`${d}/2025/L1/transcription_azuolas.txt`, "done earlier");
  fs.writeFileSync(`${s.dir}/skip.txt`, `out/2023\n`);
  s.cfg.transcription.skipListFile = `${s.dir}/skip.txt`;
  return { ...s, f };
}

test("backlog: finds untranscribed media newest first; skips transcribed, listed, tiny, non-media, excluded", () => {
  const { cfg, db, f } = archive({ exclude: ["**/Audio Record/**"] });
  const zoomerOwn = put(path.join(cfg.download.dir, "Z/zoom_9.mp4"), 10, 10);
  db.data.recordings.push({ id: "z9", path: zoomerOwn, status: "done", attempts: 0 }, { id: "v1-entry", status: "done" });
  const { candidates, skipped } = findBacklog({ cfg, db });
  assert.deepStrictEqual(candidates.map((c) => c.path), [f.fresh, zoomerOwn, f.old]);
  assert.ok(candidates[1].rec, "Zoomer's own recording is reused, not duplicated");
  assert.deepStrictEqual(skipped.map((s) => s.path).sort(), [f.done, f.listed].sort());
});

test("backlog: queueing adds file entries once; a second search finds nothing new", () => {
  const { cfg, db, f } = archive({ order: "oldest" });
  const first = findBacklog({ cfg, db }).candidates;
  assert.strictEqual(first[0].path, f.old);
  queueBacklog({ db, items: first.slice(0, 2) });
  const queued = db.data.recordings.filter((r) => r.transcription);
  assert.strictEqual(queued.length, 2);
  assert.ok(queued.every((r) => r.status === "done" && r.transcription.status === "pending" && r.id.startsWith("file-")));
  const again = findBacklog({ cfg, db }).candidates.map((c) => c.path);
  assert.ok(!again.includes(first[0].path) && !again.includes(first[1].path));
  assert.strictEqual(openDb(cfg.db.path).data.recordings.length, 2, "saved");
});

test("cli: transcribe-backlog --dry-run lists without changing the db", () => {
  const { cfg, dir } = archive();
  const conf = path.join(dir, "zoomer.config.mjs");
  fs.writeFileSync(conf, `export default ${JSON.stringify({ download: { dir: cfg.download.dir }, db: { path: cfg.db.path }, transcription: cfg.transcription })};`);
  const before = fs.readFileSync(cfg.db.path, "utf8");
  const index = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "index.js");
  const out = execFileSync(process.execPath, [index, "transcribe-backlog", "--dry-run", "--limit", "1", "--verbose"], { env: { ...process.env, ZOOMER_CONFIG: conf } }).toString();
  assert.match(out, /would queue {2}\d{4}-\d\d-\d\d {2}0 MB {2}.*L5\/Audio Record\/p1\.m4a/);
  assert.match(out, /skip {2}.*L1\/zoom_1\.mp4\n {6}transcript exists/);
  assert.match(out, /3 untranscribed, 2 skipped .*would queue 1/);
  assert.strictEqual(fs.readFileSync(cfg.db.path, "utf8"), before);
});
