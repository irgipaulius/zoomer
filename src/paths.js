import fs from "fs";
import path from "path";
import dayjs from "dayjs";

const fill = (template, vars) => template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
const safe = (s) => String(s).replace(/[/\\]/g, "-").trim();

/** Absolute path for a new recording, from download.pathTemplate. */
export function recordingPath(cfg, rec) {
  const { dir, pathTemplate, dateFormat } = cfg.download;
  const vars = { topic: safe(rec.topic), date: dayjs(rec.startTime).format(dateFormat), ext: rec.ext, id: safe(rec.id), type: rec.type };
  const segs = pathTemplate.split("/");
  const i = segs.findIndex((s) => s.includes("{n}"));
  if (i < 0) return path.join(dir, fill(pathTemplate, vars));

  // {n}: 1 + entries already in the folder holding the first {n} segment, bumped until free
  const parent = path.join(dir, ...segs.slice(0, i).map((s) => fill(s, vars)));
  const isDir = i < segs.length - 1;
  const entries = fs.existsSync(parent) ? fs.readdirSync(parent, { withFileTypes: true }) : [];
  let n = entries.filter((e) => !isDir || e.isDirectory()).length + 1;
  while (fs.existsSync(path.join(parent, fill(segs[i], { ...vars, n })))) n++;
  return path.join(parent, ...segs.slice(i).map((s) => fill(s, { ...vars, n })));
}

/** Where one transcript format for one model goes, from transcription.pathTemplate. */
export function transcriptPath(cfg, rec, model, format, language) {
  const base = path.basename(rec.path, path.extname(rec.path));
  return fill(cfg.transcription.pathTemplate, { dir: path.dirname(rec.path), base, model: safe(model), format, language: language || "" });
}
