import assert from "assert";
import fs from "fs";
import { test, quietLog } from "./harness.js";
import { testSetup } from "./setup.js";
import { createRunner } from "../src/runner.js";

const rec = (id, topic = "Math") => ({ id, topic, startTime: "2026-03-04T10:00:00Z", type: "gallery_view", ext: "mp4", size: 3, url: `u/${id}` });
const fakeZoom = (recs) => ({ listRecordings: async () => recs, getToken: async () => "tok" });
const fast = { download: { retries: 1, retryMinTimeoutMs: 1, retryMaxTimeoutMs: 1, maxAttempts: 2, concurrency: 2 } };

test("runner: queues new recordings once, downloads them, respects concurrency", async () => {
  const { cfg, db } = testSetup(fast);
  let inFlight = 0;
  let peak = 0;
  const download = async ({ dest, token }) => {
    assert.strictEqual(token, "tok");
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 10));
    inFlight--;
    fs.writeFileSync(dest, "abc");
    return 3;
  };
  const runner = createRunner({ cfg, db, zoom: fakeZoom([rec("a"), rec("b"), rec("c")]), log: quietLog, download });
  await runner.tick();
  await runner.idle();
  await runner.tick();
  await runner.idle();
  assert.strictEqual(peak, 2);
  assert.deepStrictEqual(db.data.recordings.map((r) => [r.id, r.status]), [["a", "done"], ["b", "done"], ["c", "done"]]);
  assert.strictEqual(fs.readdirSync(`${cfg.download.dir}/Math`).length, 3, "one lesson folder each, no duplicates");
  assert.ok(db.data.recordings.every((r) => !r.transcription), "transcription off by default");
});

test("runner: quick retries, then attempts per run, then gives up", async () => {
  const { cfg, db } = testSetup(fast);
  let calls = 0;
  const download = async () => {
    calls++;
    throw new Error("boom");
  };
  const runner = createRunner({ cfg, db, zoom: fakeZoom([rec("a")]), log: quietLog, download });
  await runner.tick();
  await runner.idle();
  assert.strictEqual(calls, 2); // 1 + 1 quick retry
  assert.deepStrictEqual([db.get("a").status, db.get("a").attempts, db.get("a").error], ["pending", 1, "boom"]);
  await runner.tick();
  await runner.idle();
  assert.deepStrictEqual([db.get("a").status, db.get("a").attempts], ["failed", 2]);
  await runner.tick();
  await runner.idle();
  assert.strictEqual(calls, 4, "failed jobs are not retried");
});

test("runner: listing failure still downloads the existing queue; transcription queued when enabled", async () => {
  const { cfg, db } = testSetup({ ...fast, transcription: { enabled: true } });
  db.data.recordings.push({ ...rec("old"), path: `${cfg.download.dir}/old.mp4`, status: "pending", attempts: 0 });
  const zoom = { listRecordings: async () => { throw new Error("zoom down"); }, getToken: async () => "tok" };
  const runner = createRunner({ cfg, db, zoom, log: quietLog, download: async () => 3 });
  await runner.tick();
  await runner.idle();
  assert.strictEqual(db.get("old").status, "done");
  assert.strictEqual(db.get("old").transcription.status, "pending");
});
