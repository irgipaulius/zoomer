import fetch from "node-fetch";
import dayjs from "dayjs";
import jwt from "jsonwebtoken";

import config from "../config.js"

export async function zoomFetcher(url, body) {
  if (!config.ZOOM_API_KEY || !config.ZOOM_API_SECRET) {
    throw new Error("No auth credentials set!");
  }

  const token = jwt.sign(
    {
      iss: config.ZOOM_API_KEY,
      exp: dayjs().add(1, "second").toDate().getTime(),
    },
    config.ZOOM_API_SECRET
  );

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
