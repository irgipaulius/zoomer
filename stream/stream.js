import got from "got";
import path from "path";
import { createWriteStream, existsSync } from "fs";
import stream from "stream";
import { promisify } from "util";

const pipeline = promisify(stream.pipeline);

export function startDownloading(url, filePath) {
  const downloadStream = got.stream(url);
  const fileWriterStream = createWriteStream(filePath);
  const basename = path.basename(filePath);

  console.log(`STARTED DOWNLOADING...  ${filePath}`);
  console.time(`${basename} downloading time`);

  pipeline(downloadStream, fileWriterStream)
    .then(() => console.log(`DOWNLOADED... ${filePath}`))
    .catch((error) => console.error(`Something went wrong. ${error}`))
    .finally(() => console.timeEnd(`${basename} downloading time`));
}
