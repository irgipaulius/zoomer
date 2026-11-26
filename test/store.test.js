import assert from "assert";
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { test, tmpDir } from "./harness.js";
import { openDb, initDb } from "../src/store.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const convert = path.join(root, "scripts/convert-db-v1-to-v2.js");

test("db: init, save, reopen; refuses missing and old-format files", () => {
  const file = path.join(tmpDir(), "db.json");
  assert.throws(() => openDb(file), /node index.js init/);
  const db = initDb(file);
  assert.throws(() => initDb(file), /already exists/);
  db.data.recordings.push({ id: "a", status: "done" });
  db.save();
  assert.strictEqual(openDb(file).get("a").status, "done");
  assert.deepStrictEqual(fs.readdirSync(path.dirname(file)), ["db.json"]);
  fs.writeFileSync(file, "[]");
  assert.throws(() => openDb(file), /convert-db-v1-to-v2/);
});

test("convert script: v1 array -> v2, all done, dedup, backup kept, refuses to run twice", () => {
  const file = path.join(tmpDir(), "recordingsList.json");
  const v1 = [
    { id: "r1", ts: "1/1/2023", date: "2023-01-01", topic: "T", url: "https://example.invalid/1" },
    { id: "r2", ts: "1/2/2023", date: "2023-01-02", topic: "T", url: "https://example.invalid/2" },
    { id: "r1", ts: "dup" },
  ];
  fs.writeFileSync(file, JSON.stringify(v1));
  execFileSync(process.execPath, [convert, file]);
  assert.deepStrictEqual(openDb(file).data.recordings.map((r) => [r.id, r.status]), [["r1", "done"], ["r2", "done"]]);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file + ".v1.bak", "utf8")), v1);
  assert.throws(() => execFileSync(process.execPath, [convert, file], { stdio: "pipe" }));
});
