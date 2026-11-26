#!/usr/bin/env node
// One-time conversion of the old recordings database (a plain JSON array of
// downloaded recordings) to the version 2 job database used by the app.
//
//   node scripts/convert-db-v1-to-v2.js [path/to/recordingsList.json]
//
// Every old entry is kept as-is and marked "done" (the old app recorded a
// file the moment it started downloading, so it never knew about failures).
// The original file is kept next to it as <file>.v1.bak.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.resolve(process.argv[2] || path.join(here, "..", "database", "recordingsList.json"));

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

if (!fs.existsSync(file)) fail(`not found: ${file}`);
const raw = fs.readFileSync(file, "utf8");
let old;
try {
  old = raw.trim() ? JSON.parse(raw) : [];
} catch (e) {
  fail(`not valid JSON: ${file}: ${e.message}`);
}
if (!Array.isArray(old)) {
  if (old && old.version === 2) fail(`already version 2, nothing to do: ${file}`);
  fail(`unexpected format (not a version 1 array): ${file}`);
}

const seen = new Set();
const recordings = [];
for (const entry of old) {
  if (!entry || entry.id === undefined || seen.has(String(entry.id))) continue;
  seen.add(String(entry.id));
  recordings.push({ ...entry, status: "done", attempts: 0, convertedFromV1: true });
}

const backup = `${file}.v1.bak`;
if (fs.existsSync(backup)) fail(`backup already exists, refusing to overwrite: ${backup}`);
fs.copyFileSync(file, backup);

const tmp = `${file}.convert.tmp`;
fs.writeFileSync(tmp, JSON.stringify({ version: 2, recordings }, undefined, " ") + "\n");
fs.renameSync(tmp, file);

console.log(
  `converted ${old.length} entries (${recordings.length} unique) -> ${file}\nbackup of the original: ${backup}`
);
