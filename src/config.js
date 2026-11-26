import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

const isObject = (v) => v && typeof v === "object" && !Array.isArray(v);

export function merge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) out[k] = isObject(v) && isObject(base[k]) ? merge(base[k], v) : v;
  return out;
}

const envName = (keys) => "ZOOMER_" + keys.map((k) => k.replace(/([A-Z])/g, "_$1")).join("_").toUpperCase();

function parseEnv(raw, def) {
  if (Array.isArray(def)) return raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (typeof def === "number") return Number(raw);
  if (typeof def === "boolean") return /^(1|true|yes|on)$/i.test(raw);
  if (def === null || def === "default") return raw === "" ? null : raw.includes(",") ? raw.split(",") : raw;
  return raw;
}

/** Apply ZOOMER_* env vars for every key that exists in the defaults. */
export function applyEnv(defaults, cfg, env, keys = []) {
  const out = { ...cfg };
  for (const [k, def] of Object.entries(defaults)) {
    const here = [...keys, k];
    if (isObject(def)) out[k] = applyEnv(def, cfg[k] || {}, env, here);
    else if (env[envName(here)] !== undefined) out[k] = parseEnv(env[envName(here)], def);
  }
  return out;
}

/** defaults (config.example.js) <- config.js <- env. Paths resolved against projectDir. */
export async function loadConfig(projectDir, env = process.env) {
  const load = async (file) => (await import(pathToFileURL(file).href)).default;
  const defaults = await load(path.join(projectDir, "config.example.js"));
  const userFile = path.resolve(projectDir, env.ZOOMER_CONFIG || "config.js");
  const user = fs.existsSync(userFile) ? await load(userFile) : {};
  const cfg = applyEnv(defaults, merge(defaults, user), env);
  cfg.db.path = path.resolve(projectDir, cfg.db.path);
  if (cfg.download.dir) cfg.download.dir = path.resolve(projectDir, cfg.download.dir);
  return cfg;
}

export function assertRunnable(cfg) {
  const missing = [];
  if (!cfg.zoom.accountId) missing.push("zoom.accountId");
  if (!cfg.zoom.clientId) missing.push("zoom.clientId");
  if (!cfg.zoom.clientSecret) missing.push("zoom.clientSecret");
  if (!cfg.download.dir) missing.push("download.dir");
  if (cfg.api.enabled && !cfg.api.tokens.length) missing.push("api.tokens");
  if (missing.length) throw new Error(`missing config: ${missing.join(", ")}`);
}
