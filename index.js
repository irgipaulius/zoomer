import { getUserId, getRecordings } from "./requests/index.js";
import dotenv from "dotenv";

dotenv.config();

async function download() {
  const userId = await getUserId();
  const recordings = await getRecordings(userId);

  console.log(userId);
  console.log(JSON.stringify(recordings, undefined, " "));
}

download().catch(console.error);
