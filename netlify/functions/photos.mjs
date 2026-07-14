import { getStore } from "@netlify/blobs";

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function publicBaseUrl(req) {
  const configured = Netlify.env.get("PUBLIC_BASE_URL");
  if (configured) return configured.replace(/\/$/, "");

  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const payload = await req.json();
    const match = /^data:image\/(png|jpe?g|webp);base64,(.+)$/.exec(payload.image || "");
    if (!match) return json({ error: "Invalid image" }, 400);

    const format = match[1] === "jpeg" ? "jpg" : match[1];
    const contentType = format === "jpg" ? "image/jpeg" : `image/${format}`;
    const image = Buffer.from(match[2], "base64");
    if (image.byteLength > MAX_IMAGE_BYTES) return json({ error: "Image too large" }, 413);

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const key = `${id}.${format}`;
    const store = getStore({ name: "adas-photobooth-photos", consistency: "strong" });
    await store.set(key, image, {
      metadata: {
        contentType,
        uploadedAt: new Date().toISOString(),
      },
    });

    return json({ downloadUrl: `${publicBaseUrl(req)}/download/${key}` });
  } catch (error) {
    return json({ error: "Save failed" }, 500);
  }
};

export const config = {
  path: "/api/photos",
  method: ["POST", "OPTIONS"],
};
