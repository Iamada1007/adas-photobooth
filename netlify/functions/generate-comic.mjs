import { getStore } from "@netlify/blobs";

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const DEFAULT_API_URL = "https://ark.cn-beijing.volces.com/api/v3/images/edits";
const DEFAULT_PROMPT =
  "保留原画框、文字、贴纸、排版和背景完全不变，只把照片里的真人脸变成可爱的板绘漫画脸。不要改变四格相框，不要移动人物位置，不要新增文字。";

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

function parseDataUrl(dataUrl) {
  const match = /^data:image\/(png|jpe?g|webp);base64,(.+)$/.exec(dataUrl || "");
  if (!match) return null;
  const format = match[1] === "jpeg" ? "jpg" : match[1];
  const contentType = format === "jpg" ? "image/jpeg" : `image/${format}`;
  const image = Buffer.from(match[2], "base64");
  return { image, format, contentType };
}

function normalizeBase64Image(value, fallbackFormat = "png") {
  if (!value || typeof value !== "string") return null;
  const parsed = parseDataUrl(value);
  if (parsed) return parsed;

  const compact = value.replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/=]+$/.test(compact)) return null;
  const format = fallbackFormat === "jpeg" ? "jpg" : fallbackFormat;
  const contentType = format === "jpg" ? "image/jpeg" : `image/${format}`;
  return { image: Buffer.from(compact, "base64"), format, contentType };
}

function findImageCandidate(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findImageCandidate(item);
      if (found) return found;
    }
  }
  if (typeof value === "object") {
    const keys = [
      "b64_json",
      "image",
      "image_base64",
      "base64",
      "url",
      "image_url",
      "result_url",
      "output_url",
    ];
    for (const key of keys) {
      const found = findImageCandidate(value[key]);
      if (found) return found;
    }
    for (const item of Object.values(value)) {
      const found = findImageCandidate(item);
      if (found) return found;
    }
  }
  return null;
}

async function readGeneratedImage(result) {
  const candidate = findImageCandidate(result);
  if (!candidate) throw new Error("No generated image");

  if (/^https?:\/\//.test(candidate)) {
    const response = await fetch(candidate);
    if (!response.ok) throw new Error("Generated image download failed");
    const contentType = response.headers.get("content-type") || "image/png";
    const format = contentType.includes("jpeg") ? "jpg" : contentType.includes("webp") ? "webp" : "png";
    return {
      image: Buffer.from(await response.arrayBuffer()),
      format,
      contentType: format === "jpg" ? "image/jpeg" : `image/${format}`,
    };
  }

  const parsed = normalizeBase64Image(candidate);
  if (!parsed) throw new Error("Invalid generated image");
  return parsed;
}

async function saveImage(req, image, format, contentType) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const key = `${id}-comic.${format}`;
  const store = getStore({ name: "adas-photobooth-photos", consistency: "strong" });
  await store.set(key, image, {
    metadata: {
      contentType,
      uploadedAt: new Date().toISOString(),
      source: "doubao-comic",
    },
  });

  return `${publicBaseUrl(req)}/download/${key}`;
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

  const apiKey = Netlify.env.get("DOUBAO_API_KEY") || Netlify.env.get("ARK_API_KEY");
  const model = Netlify.env.get("DOUBAO_MODEL") || Netlify.env.get("ARK_IMAGE_MODEL");
  const apiUrl = Netlify.env.get("DOUBAO_IMAGE_API_URL") || DEFAULT_API_URL;

  if (!apiKey || !model) return json({ error: "doubao not configured" }, 501);

  try {
    const payload = await req.json();
    const source = parseDataUrl(payload.image);
    if (!source) return json({ error: "Invalid image" }, 400);
    if (source.image.byteLength > MAX_IMAGE_BYTES) return json({ error: "Image too large" }, 413);

    const prompt = payload.prompt || DEFAULT_PROMPT;
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        prompt,
        image: payload.image,
        response_format: "b64_json",
        size: "auto",
        n: 1,
        watermark: false,
      }),
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      return json({ error: result.error?.message || result.message || "doubao request failed" }, response.status);
    }

    const generated = await readGeneratedImage(result);
    if (generated.image.byteLength > MAX_IMAGE_BYTES) return json({ error: "Generated image too large" }, 413);

    const downloadUrl = await saveImage(req, generated.image, generated.format, generated.contentType);
    const dataUrl = `data:${generated.contentType};base64,${generated.image.toString("base64")}`;
    return json({ image: dataUrl, downloadUrl });
  } catch (error) {
    return json({ error: error.message || "Comic generation failed" }, 500);
  }
};

export const config = {
  path: "/api/generate-comic",
  method: ["POST", "OPTIONS"],
};
