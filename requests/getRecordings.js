import { zoomFetcher } from "./getFetchOptions.js";
import dayjs from "dayjs";

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
      if (meeting.duration < 5) {
        return undefined;
      }

      const recording = getRecording(meeting.recording_files);
      console.log(meeting.id + "   " + recording);

      const topic = `${meeting.topic}`;
      const ts = dayjs(meeting.start_time).format("YYYY-MM-DD HH:mm");

      if (recording) {
        return {
          topic,
          ts,
          recording,
        };
      }
      return undefined;
    })
    .filter((x) => !!x);

  return recordings;
}

// const response = await zoomFetcher(`/users/${userId}/meetings`);

// const rrr = [];

// const r = await Promise.all(
//   response.meetings.map(({ id }) =>
//     zoomFetcher(`/meetings/${id}/recordings`)
//   )
// );
