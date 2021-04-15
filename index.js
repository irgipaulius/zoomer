import dotenv from "dotenv";

import { getUserId, getRecordings } from "./src/index.js";
import {
  alreadyDownloaded,
  setDownloaded,
} from "./database/recordingsListClient.js";

dotenv.config();

async function download() {
  const userId = await getUserId();
  const meetings = await getRecordings(userId);

  meetings
    .filter(({ id }) => !alreadyDownloaded(id))
    .map((meeting) => {
      const dbRow = {
        id: meeting.id,
        ts: new Date().toLocaleString(),
        date: meeting.date,
        topic: meeting.topic,
        url: meeting.recording.download_url,
      };
      setDownloaded(dbRow);
    });
}

download().catch(console.error);
