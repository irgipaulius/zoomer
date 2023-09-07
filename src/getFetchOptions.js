import fetch from "node-fetch";

import config from "../config.js";

export async function zoomFetcher(url, body) {
  if (!config.ZOOM_S2S_ACC_ID || !config.ZOOM_S2S_CLIENT_ID || !config.ZOOM_S2S_SECRET) {
    throw new Error("No auth credentials set!");
  }

  /* DEPRECATED */
  // const token = jwt.sign(
  //   {
  //     iss: config.ZOOM_API_KEY,
  //     exp: dayjs().add(1, "second").toDate().getTime(),
  //   },
  //   config.ZOOM_API_SECRET
  // );


  const s2sAuth = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${config.ZOOM_S2S_ACC_ID}&client_id=${config.ZOOM_S2S_CLIENT_ID}&client_secret=${config.ZOOM_S2S_SECRET}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
    }
  );

  if (s2sAuth.ok) {
    const responseData = await s2sAuth.json();

    if (responseData.access_token) {
      const token = responseData.access_token;

      const search = `${new URLSearchParams(body)}`;

      const res = await fetch(
        `https://api.zoom.us/v2${url}${search && `?${search}`}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            "User-Agent": "Zoom-api-Jwt-Request",
            "content-type": "application/json",
          },
        }
      );

      return await res.json();
    }
  }

  const errorData = await s2sAuth.text();
  console.error("OAuth Error Response:", errorData);
  throw new Error("No access token! " + errorData);
}
