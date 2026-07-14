import { getStore } from "@netlify/blobs";

function text(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export default async (req, context) => {
  if (req.method !== "GET") {
    return text("Method not allowed", 405);
  }

  const name = context.params.name || "";
  if (!/^[0-9]+-[a-z0-9]+\.png$/.test(name)) {
    return text("Not found", 404);
  }

  const store = getStore({ name: "adas-photobooth-photos", consistency: "strong" });
  const image = await store.get(name, { type: "arrayBuffer" });
  if (!image) return text("Not found", 404);

  return new Response(image, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "public, max-age=86400",
      "Access-Control-Allow-Origin": "*",
    },
  });
};

export const config = {
  path: "/download/:name",
  method: ["GET"],
};
