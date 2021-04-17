import path from "path";
import { readdirSync, existsSync, mkdirSync } from "fs";

const lessonTemplate = (date, topic, postfix) => `${date} ${topic} ${postfix}`;

const filenameTemplate = (date, postfix, extention) =>
  `${date}_zoom_${postfix}.${extention}`;

export function constructFilename(topic, date, recording, offset = 0) {
  const topicPath = path.join(getDestinationPath(), topic);

  if (!existsSync(topicPath)) {
    mkdirSync(topicPath);
  }

  // get topic directories
  const directories = readdirSync(topicPath, { withFileTypes: true }).reduce(
    (allDirs, item) => (item.isDirectory() ? [...allDirs, item.name] : allDirs),
    []
  );

  let postfix = directories.length + 1 + offset;
  const lesson = lessonTemplate(date, topic, postfix);
  const lessonPath = path.join(topicPath, lesson);

  // if for some reason a file with that name exists, then try to create another one
  if (existsSync(lessonPath)) {
    return constructFilename(topic, date, recording, offset + 0.01);
  }
  mkdirSync(lessonPath);

  const file = filenameTemplate(
    date,
    postfix,
    recording.file_extension.toLowerCase()
  );

  return path.join(lessonPath, file);
}

export function getDestinationPath() {
  try {
    return path.resolve(process.env.DESTINATION);
  } catch (e) {
    throw new Error("no DESTINATION env found");
  }
}

export function getProjectPath() {
  try {
    return path.resolve(process.env.LOCATION);
  } catch (e) {
    throw new Error("no LOCATION env found");
  }
}
