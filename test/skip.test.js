import assert from "assert";
import fs from "fs";
import path from "path";
import { test, quietLog } from "./harness.js";
import { testSetup } from "./setup.js";
import { createSkipCheck, ownOutputPattern } from "../src/skip.js";
import { createRunner } from "../src/runner.js";

function lesson(cfg, rel = "Math/2026-03-04 Math 1/2026-03-04_zoom_1.mp4") {
  const file = path.join(cfg.download.dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "abc");
  return file;
}

test("skip: own output pattern counts for any model and format", () => {
  assert.strictEqual(ownOutputPattern("{dir}/{base}.{model}.{format}"), "{dir}/{base}.*.*");
  const { cfg } = testSetup();
  const file = lesson(cfg);
  const check = createSkipCheck(cfg);
  assert.strictEqual(check(file), null, "the recording itself is not a transcript");
  fs.writeFileSync(file.replace(/\.mp4$/, ".big-model.txt"), "hi");
  assert.match(check(file), /transcript exists: .*2026-03-04_zoom_1\.big-model\.txt$/);
});

test("skip: folder-level and per-file globs, literal names, special characters", () => {
  const { cfg } = testSetup({ transcription: { skipIfExists: ["transcription_*.txt", "{name}.transcription_*.txt", "../done/{base}.txt"] } });
  const a = lesson(cfg, "A/lesson [1] (x)/rec*1.mp4");
  const b = lesson(cfg, "B/legacy/one.m4a");
  lesson(cfg, "B/legacy/two.m4a");
  const check = createSkipCheck(cfg);
  assert.strictEqual(check(a), null);
  fs.writeFileSync(path.join(path.dirname(a), "transcription_azuolas.txt"), "x");
  assert.match(check(a), /transcription_azuolas\.txt$/);
  fs.writeFileSync(path.join(path.dirname(b), "two.m4a.transcription_azuolas.txt"), "x");
  assert.strictEqual(check(b), null, "another file's transcript does not count");
  fs.writeFileSync(path.join(path.dirname(b), "one.m4a.transcription_whisper.txt"), "x");
  assert.match(check(b), /one\.m4a\.transcription_whisper\.txt$/);
  const c = lesson(cfg, "C/x/three.mp4");
  fs.mkdirSync(path.join(cfg.download.dir, "C", "done"));
  fs.writeFileSync(path.join(cfg.download.dir, "C", "done", "three.txt"), "x");
  assert.match(createSkipCheck(cfg)(c), /done\/three\.txt$/);
});

test("skip: list file entries (files and folders, relative, comments, NFC/NFD) and reloads on change", () => {
  const { cfg, dir } = testSetup();
  const list = path.join(dir, "skip.txt");
  cfg.transcription.skipListFile = list;
  const a = lesson(cfg, "Курс/Урок й/a.mp4");
  const b = lesson(cfg, "Other/b.mp4");
  fs.writeFileSync(list, `# managed elsewhere\nout/Курс/Урок й\n`.normalize("NFD"));
  const check = createSkipCheck(cfg);
  assert.match(check(a), /listed in skipListFile/);
  assert.strictEqual(check(b), null);
  fs.writeFileSync(list, `${b}\n`);
  fs.utimesSync(list, new Date(), new Date(Date.now() + 5000));
  assert.strictEqual(check(a), null);
  assert.match(check(b), /listed/);
  assert.strictEqual(check(path.join(cfg.download.dir, "Other", "b.mp4x")), null, "prefix of a name is not a match");
});

test("skip: a missing list file fails closed", () => {
  const { cfg, dir } = testSetup({ transcription: { skipListFile: "/nonexistent/skip.txt" } });
  assert.throws(() => createSkipCheck(cfg)(path.join(dir, "x.mp4")), /skipListFile not readable/);
});

test("runner: does not queue transcription when a transcript already exists", async () => {
  const { cfg, db } = testSetup({ transcription: { enabled: true, skipIfExists: ["transcription_*.txt"] }, download: { retries: 0 } });
  const rec = { id: "a", topic: "Math", startTime: "2026-03-04T10:00:00Z", type: "gallery_view", ext: "mp4", size: 3, url: "u/a" };
  const download = async ({ dest }) => {
    fs.writeFileSync(dest, "abc");
    fs.writeFileSync(path.join(path.dirname(dest), "transcription_x.txt"), "done before");
    return 3;
  };
  const runner = createRunner({ cfg, db, zoom: { listRecordings: async () => [rec], getToken: async () => "t" }, log: quietLog, download });
  await runner.tick();
  await runner.idle();
  assert.strictEqual(db.get("a").status, "done");
  assert.strictEqual(db.get("a").transcription.status, "skipped");
  assert.match(db.get("a").transcription.reason, /transcription_x\.txt/);
});

test("skip: files the job itself already wrote do not count (resume after a lost lease)", () => {
  const { cfg } = testSetup();
  const file = lesson(cfg);
  const mine = file.replace(/\.mp4$/, ".m1.txt");
  fs.writeFileSync(mine, "partial");
  const check = createSkipCheck(cfg);
  assert.strictEqual(check(file, [mine]), null);
  assert.match(check(file), /m1\.txt/);
});
