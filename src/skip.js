import fs from "fs";
import path from "path";
import picomatch from "picomatch";

const PLACEHOLDER = /\{(\w+)\}/g;
const GLOB_CHARS = /[*?[\]]/;
const escapeGlob = (s) => String(s).replace(/[*?[\](){}!+@\\]/g, "\\$&");
const nfc = (p) => path.resolve(p).normalize("NFC");

/** transcription.pathTemplate as a pattern matching our own output for any model/format/language. */
export function ownOutputPattern(pathTemplate) {
  return pathTemplate.replace(/\{(model|format|language)\}/g, "*");
}

/**
 * Returns check(recordingPath) -> reason string if the recording must not be transcribed
 * (a transcript already exists, or it is listed in transcription.skipListFile), else null.
 *
 * transcription.skipIfExists: path patterns, relative to the recording's folder unless absolute.
 *   Placeholders {dir} {name} (file name) {base} (name without extension); * ? [] wildcards
 *   are allowed in the last path segment. Our own output (transcription.pathTemplate) always counts.
 * transcription.skipListFile: optional text file, one path per line (# comments); a recording
 *   at or under a listed path is skipped. Relative lines are relative to the list file's folder.
 */
export function createSkipCheck(cfg) {
  const t = cfg.transcription;
  const own = [t.pathTemplate, t.sharedFolderPathTemplate].filter(Boolean).map(ownOutputPattern);
  const patterns = [...own, ...(t.skipIfExists || [])];
  let listCache = { mtimeMs: -1, paths: [] };

  function listed() {
    if (!t.skipListFile) return [];
    let st;
    try {
      st = fs.statSync(t.skipListFile);
    } catch (e) {
      throw new Error(`transcription.skipListFile not readable: ${t.skipListFile} (${e.code})`);
    }
    if (st.mtimeMs !== listCache.mtimeMs) {
      const base = path.dirname(t.skipListFile);
      const paths = fs
        .readFileSync(t.skipListFile, "utf8")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"))
        .map((l) => nfc(path.resolve(base, l)));
      listCache = { mtimeMs: st.mtimeMs, paths };
    }
    return listCache.paths;
  }

  /** ownFiles: transcript files this recording's current job already wrote (they don't count). */
  return function check(recPath, ownFiles = []) {
    const own = new Set(ownFiles.map((f) => path.resolve(f)));
    const dir = path.dirname(recPath);
    const name = path.basename(recPath);
    const vars = { dir, name, base: path.basename(name, path.extname(name)) };
    const listing = new Map();
    const entries = (d) => {
      if (!listing.has(d)) listing.set(d, fs.existsSync(d) ? fs.readdirSync(d) : []);
      return listing.get(d);
    };
    for (const p of patterns) {
      const isGlob = GLOB_CHARS.test(p.replace(PLACEHOLDER, ""));
      const filled = p.replace(PLACEHOLDER, (m, k) => (k in vars ? (isGlob && k !== "dir" ? escapeGlob(vars[k]) : vars[k]) : m));
      const abs = path.resolve(dir, filled);
      if (!isGlob) {
        if (abs !== path.resolve(recPath) && !own.has(abs) && fs.existsSync(abs)) return `transcript exists: ${abs}`;
        continue;
      }
      const match = picomatch(path.basename(abs), { dot: true });
      const d = path.dirname(abs);
      const hit = entries(d).find((e) => e !== name && match(e) && !own.has(path.join(d, e)));
      if (hit) return `transcript exists: ${path.join(d, hit)}`;
    }
    const me = nfc(recPath);
    const l = listed().find((x) => me === x || me.startsWith(x + path.sep));
    return l ? `listed in skipListFile: ${l}` : null;
  };
}
