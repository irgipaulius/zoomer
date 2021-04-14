import { zoomFetcher } from "./getFetchOptions.js";

export async function getUserId() {
  const userEmail = process.env.ZOOM_ACCOUNT_EMAIL || undefined;

  const response = await zoomFetcher(`/users`);

  // if ZOOM_ACCOUNT_EMAIL is not set, then select the first user.
  const user = response.users.find(({ email }) =>
    userEmail ? userEmail === email : true
  );

  return user.id;
}
