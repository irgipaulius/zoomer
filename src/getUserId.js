import { zoomFetcher } from "./getFetchOptions.js";
import config from "../config.js"

export async function getUserId() {
  if (config.ZOOM_USER_ID) {
    return config.ZOOM_USER_ID;
  }

  const response = await zoomFetcher(`/users`);

  // select first found user. I don't like using [0]
  const user = response.users.find(() => true);

  return user.id;
}
