import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { test, tmpDir } from "./harness.js";
import { loadConfig, applyEnv } from "../src/config.js";
import defaults from "../config.example.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("config: defaults <- config file <- env, paths resolved", async () => {
  const file = path.join(tmpDir(), "my-config.mjs");
  fs.writeFileSync(file, `export default { download: { dir: "/rec", concurrency: 4 }, zoom: { clientId: "file" } };`);
  const cfg = await loadConfig(root, {
    ZOOMER_CONFIG: file,
    ZOOMER_ZOOM_CLIENT_ID: "env",
    ZOOMER_DOWNLOAD_VERIFY_SIZE: "false",
    ZOOMER_API_TOKENS: "a, b",
    ZOOMER_SCHEDULE_CRON: "0 * * * *",
  });
  assert.strictEqual(cfg.download.concurrency, 4);
  assert.strictEqual(cfg.download.retries, defaults.download.retries);
  assert.strictEqual(cfg.zoom.clientId, "env");
  assert.strictEqual(cfg.download.verifySize, false);
  assert.deepStrictEqual(cfg.api.tokens, ["a", "b"]);
  assert.strictEqual(cfg.schedule.cron, "0 * * * *");
  assert.strictEqual(cfg.db.path, path.join(root, "database", "recordingsList.json"));
});

test("config: env values are typed from the defaults", () => {
  const cfg = applyEnv(defaults, defaults, {
    ZOOMER_DOWNLOAD_CONCURRENCY: "3",
    ZOOMER_TRANSCRIPTION_MODELS: "a,b",
    ZOOMER_TRANSCRIPTION_LANGUAGE: "lt",
    ZOOMER_ZOOM_FILE_TYPE_PREFERENCE: "audio_only",
  });
  assert.strictEqual(cfg.download.concurrency, 3);
  assert.deepStrictEqual(cfg.transcription.models, ["a", "b"]);
  assert.strictEqual(cfg.transcription.language, "lt");
  assert.deepStrictEqual(cfg.zoom.fileTypePreference, ["audio_only"]);
});
