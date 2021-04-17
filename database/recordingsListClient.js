import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { getProjectPath } from "../src/fsStructure.js";

const dbFilepath = () =>
  path.resolve(getProjectPath(), "./database/recordingsList.json");

const getList = () => {
  const content = readFileSync(dbFilepath(), { encoding: "utf8" });
  if (content) {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  }
  return [];
};

export function isAlreadyDownloaded(id) {
  const list = getList();
  return list.some((recording) => recording.id == id);
}

export function setDownloaded(recording) {
  const list = getList();
  const newListString = JSON.stringify([...list, recording], undefined, " ");
  writeFileSync(dbFilepath(), newListString, { encoding: "utf8" });
}
