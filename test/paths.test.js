import assert from "assert";
import fs from "fs";
import path from "path";
import { test } from "./harness.js";
import { testSetup } from "./setup.js";
import { recordingPath, transcriptPath } from "../src/paths.js";

const rec = { id: "r1", topic: "Math/Algebra", startTime: "2026-03-04T10:00:00Z", ext: "mp4", type: "gallery_view" };

test("paths: default template numbers lessons per topic and skips taken names", () => {
  const { cfg } = testSetup();
  const first = recordingPath(cfg, rec);
  assert.strictEqual(first, path.join(cfg.download.dir, "Math-Algebra", "2026-03-04 Math-Algebra 1", "2026-03-04_zoom_1.mp4"));
  fs.mkdirSync(path.dirname(first), { recursive: true });
  fs.mkdirSync(path.join(cfg.download.dir, "Math-Algebra", "2026-03-04 Math-Algebra 3"));
  assert.match(recordingPath(cfg, rec), /Math-Algebra 4/);
});

test("paths: custom templates and transcript paths", () => {
  const { cfg } = testSetup({ download: { pathTemplate: "{date}/{id}.{type}.{ext}", dateFormat: "YYYYMMDD" } });
  const p = recordingPath(cfg, rec);
  assert.strictEqual(p, path.join(cfg.download.dir, "20260304", "r1.gallery_view.mp4"));
  assert.strictEqual(transcriptPath(cfg, { path: p }, "big/model", "srt", "lt"), path.join(path.dirname(p), "r1.gallery_view.big-model.srt"));
});
