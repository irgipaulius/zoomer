import assert from "assert";
import fs from "fs";
import path from "path";
import got from "got";
import { test, quietLog } from "./harness.js";
import { testSetup } from "./setup.js";
import { createApi } from "../src/api.js";
import { newTranscription } from "../src/store.js";

const TOKEN = "worker-secret";

// A recording that finished downloading and is waiting for transcription.
async function setup(overrides = {}) {
  const { cfg, db } = testSetup({ api: { tokens: [TOKEN], publicUrl: "https://zoomer.example" }, transcription: { enabled: true, maxAttempts: 2, leaseSeconds: 60, ...overrides } });
  const file = path.join(cfg.download.dir, "Math", "2026-03-04_zoom_1.mp4");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "0123456789");
  db.data.recordings.push({ id: "r1", topic: "Math", startTime: "2026-03-04T10:00:00Z", durationS: 60, path: file, bytes: 10, status: "done", attempts: 0, transcription: newTranscription() });
  let t = Date.parse("2026-03-04T12:00:00Z");
  const clock = { now: () => t, advance: (ms) => (t += ms) };
  const server = createApi({ cfg, db, log: quietLog, now: clock.now }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}${cfg.api.basePath}`;
  // the fake worker
  const call = (method, p, json, extra = {}) =>
    got(`${base}${p}`, { method, json, headers: { authorization: `Bearer ${TOKEN}`, ...extra }, throwHttpErrors: false, retry: 0 });
  const post = async (p, json) => {
    const res = await call("POST", p, json);
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
  };
  return { cfg, db, file, clock, base, call, post, close: () => server.close() };
}

test("api: health is open, everything else needs a worker token", async () => {
  const s = await setup();
  try {
    assert.strictEqual(JSON.parse((await got(`${s.base}/health`)).body).ok, true);
    const res = await got.post(`${s.base}/jobs/claim`, { json: {}, throwHttpErrors: false, headers: { authorization: "Bearer nope" } });
    assert.strictEqual(res.statusCode, 401);
  } finally {
    s.close();
  }
});

test("api: fake worker claims, streams media with Range, posts results, completes", async () => {
  const s = await setup();
  try {
    const { status, body: job } = await s.post("/jobs/claim", { worker_id: "w1", types: ["transcribe"], capabilities: { models: ["m1"] } });
    assert.strictEqual(status, 200);
    assert.strictEqual(job.type, "transcribe");
    assert.strictEqual(job.media.url, "https://zoomer.example/api/v1/jobs/r1/media");
    assert.strictEqual(job.media.content_type, "video/mp4");
    assert.deepStrictEqual(job.done_models, []);
    assert.strictEqual((await s.post("/jobs/claim", { worker_id: "w2" })).status, 204, "leased jobs are not handed out twice");

    const media = await s.call("GET", "/jobs/r1/media", undefined, { range: "bytes=2-5" });
    assert.strictEqual(media.statusCode, 206);
    assert.strictEqual(media.body, "2345");

    assert.strictEqual((await s.post("/jobs/r1/heartbeat", { lease_id: "wrong" })).status, 409);
    assert.ok((await s.post("/jobs/r1/heartbeat", { lease_id: job.lease_id })).body.lease_expires_at);

    const result = { lease_id: job.lease_id, model: "m1", language: "lt", text: "labas", srt: "1\n00:00:00,000 --> 00:00:01,000\nlabas\n", segments: [{ start: 0, end: 1, text: "labas" }] };
    const saved = await s.post("/jobs/r1/results", result);
    assert.strictEqual(saved.status, 200);
    const base = s.file.replace(/\.mp4$/, "");
    assert.strictEqual(fs.readFileSync(`${base}.m1.txt`, "utf8"), "labas");
    assert.ok(fs.existsSync(`${base}.m1.srt`));
    assert.ok(!fs.existsSync(`${base}.m1.vtt`), "formats the worker did not send are skipped");
    assert.strictEqual(JSON.parse(fs.readFileSync(`${base}.m1.json`, "utf8")).segments.length, 1);

    assert.strictEqual((await s.post("/jobs/r1/complete", { lease_id: job.lease_id })).status, 200);
    assert.strictEqual(s.db.get("r1").transcription.status, "done");
    assert.deepStrictEqual(s.db.get("r1").transcription.doneModels, ["m1"]);
    assert.strictEqual((await s.post("/jobs/r1/complete", { lease_id: job.lease_id })).status, 409);
  } finally {
    s.close();
  }
});

test("api: expired lease goes back to pending, keeps done_models, then gives up", async () => {
  const s = await setup();
  try {
    const first = (await s.post("/jobs/claim", { worker_id: "w1" })).body;
    await s.post("/jobs/r1/results", { lease_id: first.lease_id, model: "m1", text: "x" });
    s.clock.advance(61 * 1000);
    assert.strictEqual((await s.post("/jobs/r1/complete", { lease_id: first.lease_id })).status, 409);
    const second = (await s.post("/jobs/claim", { worker_id: "w2" })).body;
    assert.deepStrictEqual(second.done_models, ["m1"]);
    s.clock.advance(61 * 1000);
    assert.strictEqual((await s.post("/jobs/claim", { worker_id: "w3" })).status, 204);
    assert.strictEqual(s.db.get("r1").transcription.status, "failed");
  } finally {
    s.close();
  }
});

test("api: fail is retried when retryable, final when not; language filter", async () => {
  const s = await setup({ language: "lt" });
  try {
    assert.strictEqual((await s.post("/jobs/claim", { worker_id: "w", capabilities: { languages: ["ru"] } })).status, 204);
    const a = (await s.post("/jobs/claim", { worker_id: "w", capabilities: { languages: ["lt"] } })).body;
    assert.strictEqual(a.options.language, "lt");
    await s.post(`/jobs/r1/fail`, { lease_id: a.lease_id, error: "gpu busy", retryable: true });
    assert.strictEqual(s.db.get("r1").transcription.status, "pending");
    const b = (await s.post("/jobs/claim", { worker_id: "w" })).body;
    await s.post(`/jobs/r1/fail`, { lease_id: b.lease_id, error: "bad audio", retryable: false });
    assert.deepStrictEqual([s.db.get("r1").transcription.status, s.db.get("r1").transcription.error], ["failed", "bad audio"]);
  } finally {
    s.close();
  }
});

test("api: claim skips a job whose transcript appeared after it was queued", async () => {
  const s = await setup({ skipIfExists: ["transcription_*.txt"] });
  try {
    fs.writeFileSync(path.join(path.dirname(s.file), "transcription_other.txt"), "made by another tool");
    const res = await s.call("POST", "/jobs/claim", { worker_id: "w1" });
    assert.strictEqual(res.statusCode, 204);
    assert.strictEqual(s.db.get("r1").transcription.status, "skipped");
  } finally {
    s.close();
  }
});

test("api: claim hands out nothing when the skip list cannot be read", async () => {
  const s = await setup({ skipListFile: "/nonexistent/list.txt" });
  try {
    const res = await s.call("POST", "/jobs/claim", { worker_id: "w1" });
    assert.strictEqual(res.statusCode, 503);
    assert.strictEqual(s.db.get("r1").transcription.status, "pending");
  } finally {
    s.close();
  }
});

test("api: results never overwrite a file the job did not write", async () => {
  const s = await setup();
  try {
    const job = (await s.post("/jobs/claim", { worker_id: "w1" })).body;
    const base = s.file.replace(/\.mp4$/, "");
    fs.writeFileSync(`${base}.m1.txt`, "someone else's"); // appears mid-job
    const r1 = await s.post("/jobs/r1/results", { lease_id: job.lease_id, model: "m1", text: "ours" });
    assert.strictEqual(fs.readFileSync(`${base}.m1.txt`, "utf8"), "someone else's");
    assert.ok(r1.body.files.includes(`${base}.m1.1.txt`));
    await s.post("/jobs/r1/results", { lease_id: job.lease_id, model: "m1", text: "ours again" });
    assert.strictEqual(fs.readFileSync(`${base}.m1.1.txt`, "utf8"), "ours again", "re-posting replaces only our own file");
    assert.ok(!fs.existsSync(`${base}.m1.2.txt`));
  } finally {
    s.close();
  }
});
