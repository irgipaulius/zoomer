import path from "path";
import { tmpDir } from "./harness.js";
import { merge } from "../src/config.js";
import defaults from "../config.example.js";
import { initDb } from "../src/store.js";

/** Defaults + overrides, with a fresh download dir and db in a temp folder. */
export function testSetup(overrides = {}) {
  const dir = tmpDir();
  const cfg = merge(defaults, overrides);
  cfg.download = { ...cfg.download, dir: path.join(dir, "out") };
  cfg.db = { ...cfg.db, path: path.join(dir, "db.json") };
  return { cfg, db: initDb(cfg.db.path), dir };
}

