import fs from "fs";
import path from "path";
import writeFileAtomic from "write-file-atomic";

export const DB_VERSION = 2;

/** Initial state of a recording's optional transcribe job. */
export const newTranscription = () => ({ status: "pending", attempts: 0, doneModels: [], files: [] });

/**
 * The job database: { version: 2, recordings: [ { id, path, status, attempts, transcription?, ... } ] }.
 * Saved atomically (temp file + rename), so a crash never leaves a broken file.
 */
export function openDb(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`database not found: ${file}\nRestore your database there, or run "node index.js init" for a fresh install.`);
  }
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (Array.isArray(data)) {
    throw new Error(`database is in the old format: ${file}\nConvert it once with: node scripts/convert-db-v1-to-v2.js "${file}"`);
  }
  if (!data || data.version !== DB_VERSION || !Array.isArray(data.recordings)) {
    throw new Error(`unsupported database format (expected version ${DB_VERSION}): ${file}`);
  }
  return {
    file,
    data,
    get: (id) => data.recordings.find((r) => r.id == id),
    save: () => writeFileAtomic.sync(file, JSON.stringify(data, undefined, " ") + "\n"),
  };
}

export function initDb(file) {
  if (fs.existsSync(file)) throw new Error(`database already exists: ${file}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeFileAtomic.sync(file, JSON.stringify({ version: DB_VERSION, recordings: [] }, undefined, " ") + "\n");
  return openDb(file);
}
