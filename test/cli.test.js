import assert from "assert";
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import lockfile from "proper-lockfile";
import { test, tmpDir } from "./harness.js";

const index = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "index.js");

function cli(args, dir) {
  const env = {
    ...process.env,
    ZOOMER_CONFIG: path.join(dir, "none.js"),
    ZOOMER_DB_PATH: path.join(dir, "db.json"),
    ZOOMER_DOWNLOAD_DIR: path.join(dir, "out"),
    ZOOMER_ZOOM_ACCOUNT_ID: "a",
    ZOOMER_ZOOM_CLIENT_ID: "b",
    ZOOMER_ZOOM_CLIENT_SECRET: "c",
  };
  return execFileSync(process.execPath, [index, ...args], { env, encoding: "utf8", stdio: "pipe" });
}

test("cli: init, status, and a second instance exits without touching Zoom", () => {
  const dir = tmpDir();
  assert.match(cli(["init"], dir), /created/);
  assert.match(cli(["status"], dir), /downloads: \{\}/);
  const release = lockfile.lockSync(path.join(dir, "db.json"));
  try {
    assert.match(cli(["--once"], dir), /another zoomer instance is running/);
  } finally {
    release();
  }
  assert.ok(!fs.existsSync(path.join(dir, "out")));
});
