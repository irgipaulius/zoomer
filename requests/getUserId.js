import { zoomFetcher } from "./getFetchOptions.js";

export async function getUserId() {
  if (process.env.ZOOM_USER_ID) {
    return process.env.ZOOM_USER_ID;
  }

  const response = await zoomFetcher(`/users`);

  // select first found user. I don't like using [0]
  const user = response.users.find(() => true);

  return user.id;
}
