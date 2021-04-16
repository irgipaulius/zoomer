import got from "got";
import path from "path";
import { createWriteStream, existsSync } from "fs";
import stream from "stream";
import { promisify } from "util";

const pipeline = promisify(stream.pipeline);

export function startDownloading(url, filePath) {
  const downloadStream = got.stream(url);
  const fileWriterStream = createWriteStream(filePath);

  console.log(`STARTED DOWNLOADING...\nfrom ${url}\nto ${filePath}`);
  console.time("downloading time");

  pipeline(downloadStream, fileWriterStream)
    .then(() => console.log(`File downloaded to ${filePath}`))
    .catch((error) => console.error(`Something went wrong. ${error}`))
    .finally(() => console.timeEnd("downloading time"));
}
