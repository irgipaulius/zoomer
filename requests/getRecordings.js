import { zoomFetcher } from "./getFetchOptions.js";

export async function getRecordings(userId) {
  const response = await zoomFetcher(`/users/${userId}/recordings`);

  return response;
}
