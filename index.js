import dotenv from "dotenv";

import { getUserId } from "./src/getUserId.js";
import { getRecordings } from "./src/getRecordings.js";
import { setDownloaded } from "./database/recordingsListClient.js";
import { startDownloading } from "./stream/stream.js";
import { constructFilename } from "./src/fsStructure.js";

dotenv.config();

async function download() {
  const userId = await getUserId();
  const meetings = await getRecordings(userId);

  meetings.map((meeting) => {
    const filename = constructFilename(
      meeting.topic,
      meeting.date,
      meeting.recording
    );

    startDownloading(meeting.recording.download_url, filename);

    false &&
      setDownloaded({
        id: meeting.id,
        ts: new Date().toLocaleString(),
        date: meeting.date,
        topic: meeting.topic,
        url: meeting.recording.download_url,
      });
  });
}

download().catch(console.error);
