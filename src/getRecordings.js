import dayjs from "dayjs";
import { isAlreadyDownloaded } from "../database/recordingsListClient.js";

import { zoomFetcher } from "./getFetchOptions.js";

function getRecording(recordings) {
  const selectRecording = (type) =>
    recordings.find(
      ({ status, recording_type }) =>
        recording_type === type && status === "completed"
    );

  const screenshare = selectRecording("shared_screen_with_gallery_view");
  if (screenshare) {
    return screenshare;
  }
  const gallery = selectRecording("gallery_view");
  if (gallery) {
    return gallery;
  }
  const speaker = selectRecording("active_speaker");
  if (speaker) {
    return speaker;
  }
  const audio = selectRecording("audio_only");
  if (audio) {
    return audio;
  }

  return undefined;
}

export async function getRecordings(userId) {
  const response = await zoomFetcher(`/users/${userId}/recordings`);
  const recordings = response.meetings
    .map((meeting) => {
      const recording = getRecording(meeting.recording_files);
      if (recording) {
        if (isAlreadyDownloaded(recording.id)) {
          return undefined;
        }

        const date = dayjs(meeting.start_time).format("YYYY-MM-DD");

        return {
          id: recording.id,
          topic: `${meeting.topic}`.trim(),
          date,
          recording,
        };
      }
      return undefined;
    })
    .filter((x) => !!x);

  return recordings;
}
