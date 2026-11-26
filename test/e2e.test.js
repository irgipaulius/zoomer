import assert from "assert";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import got from "got";
import { test, tmpDir, serve } from "./harness.js";

const index = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "index.js");
const until = async (check, ms = 10000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) if (await check()) return;
  throw new Error("timed out waiting");
};

test("e2e: long-running zoomer against a fake Zoom, a fake worker transcribes, SIGTERM stops cleanly", async () => {
  const dir = tmpDir();
  const zoom = await serve((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url.startsWith("/oauth")) return res.end(JSON.stringify({ access_token: "tok", expires_in: 3600 }));
    if (req.url.startsWith("/v2/users/me/recordings")) {
      const files = [{ id: "f1", recording_type: "audio_only", status: "completed", file_extension: "M4A", file_size: 5, download_url: `${zoom.url}/file` }];
      return res.end(JSON.stringify({ meetings: [{ topic: "Lesson", start_time: "2026-03-04T10:00:00Z", duration: 1, recording_files: files }] }));
    }
    res.setHeader("content-type", "audio/mp4");
    res.end(req.headers.authorization === "Bearer tok" ? "audio" : "");
  });
  const port = 20000 + Math.floor(Math.random() * 20000);
  const env = {
    ...process.env,
    ZOOMER_CONFIG: path.join(dir, "none.js"),
    ZOOMER_DB_PATH: path.join(dir, "db.json"),
    ZOOMER_DOWNLOAD_DIR: path.join(dir, "out"),
    ZOOMER_ZOOM_ACCOUNT_ID: "a",
    ZOOMER_ZOOM_CLIENT_ID: "b",
    ZOOMER_ZOOM_CLIENT_SECRET: "c",
    ZOOMER_ZOOM_OAUTH_URL: `${zoom.url}/oauth`,
    ZOOMER_ZOOM_API_URL: `${zoom.url}/v2`,
    ZOOMER_SCHEDULE_CRON: "*/2 * * * * *",
    ZOOMER_TRANSCRIPTION_ENABLED: "true",
    ZOOMER_API_ENABLED: "true",
    ZOOMER_API_PORT: String(port),
    ZOOMER_API_TOKENS: "w",
  };
  const run = (args) => spawn(process.execPath, [index, ...args], { env, stdio: "pipe" });
  await new Promise((r) => run(["init"]).on("exit", r));
  const proc = run([]);
  let out = "";
  proc.stdout.on("data", (d) => (out += d));
  proc.stderr.on("data", (d) => (out += d));
  const api = `http://127.0.0.1:${port}/api/v1`;
  const auth = { authorization: "Bearer w" };
  try {
    const audio = path.join(dir, "out", "Lesson", "2026-03-04 Lesson 1", "2026-03-04_zoom_1.m4a");
    await until(() => fs.existsSync(audio));
    let job;
    await until(async () => {
      const res = await got.post(`${api}/jobs/claim`, { json: { worker_id: "fake" }, headers: auth, throwHttpErrors: false });
      job = res.statusCode === 200 && JSON.parse(res.body);
      return job;
    });
    assert.strictEqual((await got(job.media.url, { headers: auth })).body, "audio");
    await got.post(`${api}/jobs/${job.id}/results`, { json: { lease_id: job.lease_id, model: "fake-model", text: "hello" }, headers: auth });
    await got.post(`${api}/jobs/${job.id}/complete`, { json: { lease_id: job.lease_id }, headers: auth });
    assert.strictEqual(fs.readFileSync(audio.replace(/m4a$/, "fake-model.txt"), "utf8"), "hello");
  } finally {
    proc.kill("SIGTERM");
    await new Promise((r) => proc.on("exit", r));
    await zoom.close();
  }
  assert.match(out, /SIGTERM: stopping/);
  assert.ok(!fs.existsSync(path.join(dir, "db.json.lock")), "instance lock released");
  const db = JSON.parse(fs.readFileSync(path.join(dir, "db.json"), "utf8"));
  assert.deepStrictEqual([db.recordings[0].status, db.recordings[0].transcription.status], ["done", "done"]);
});
