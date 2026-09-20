import fs from "node:fs";
import path from "node:path";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]);

function isImageExtension(ext) {
  if (!ext) return false;
  return IMAGE_EXTENSIONS.has(ext.toLowerCase().replace(/^\./, ""));
}

function normalizeUrl(rawUrl, baseUrl) {
  if (!rawUrl) return null;
  const trimmed = rawUrl.trim();
  if (trimmed.startsWith("data:")) return null; // inline base64, skip or handle if needed
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  const cleanBase = baseUrl.replace(/\/+$/, "");
  if (trimmed.startsWith("/")) {
    // If baseUrl already has subpath like /zentao and rawUrl also has /zentao
    try {
      const parsedBase = new URL(cleanBase);
      const basePath = parsedBase.pathname.replace(/\/+$/, "");
      if (basePath && trimmed.startsWith(basePath)) {
        return `${parsedBase.origin}${trimmed}`;
      }
      return `${parsedBase.origin}${trimmed}`;
    } catch {
      return `${cleanBase}${trimmed}`;
    }
  }
  return `${cleanBase}/${trimmed}`;
}

export function extractBugImages(bug, baseUrl = "") {
  const images = [];
  const seenUrls = new Set();

  function addImage(rawUrl, source, extra = {}) {
    if (!rawUrl) return;
    const url = normalizeUrl(rawUrl, baseUrl);
    if (!url || seenUrls.has(url)) return;
    seenUrls.add(url);

    let filename = extra.filename;
    if (!filename) {
      try {
        const u = new URL(url);
        filename = path.basename(u.pathname);
      } catch {
        filename = path.basename(url);
      }
    }
    if (!filename || filename === "/" || filename === ".") {
      filename = `image_${images.length + 1}.png`;
    }

    images.push({
      url,
      filename,
      source,
      title: extra.title || filename,
    });
  }

  // 1. Check steps (HTML, Markdown, or {file.png} tags)
  if (bug.steps && typeof bug.steps === "string") {
    // HTML <img src="...">
    const imgTagRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
    let match;
    while ((match = imgTagRegex.exec(bug.steps)) !== null) {
      addImage(match[1], "steps");
    }

    // Markdown ![alt](url)
    const mdImgRegex = /!\[.*?\]\(([^\s)]+)\)/gi;
    while ((match = mdImgRegex.exec(bug.steps)) !== null) {
      addImage(match[1], "steps");
    }

    // ZenTao internal {124035.png} tag
    const zentaoTagRegex = /\{([0-9]+\.(?:png|jpg|jpeg|gif|webp|bmp))\}/gi;
    while ((match = zentaoTagRegex.exec(bug.steps)) !== null) {
      addImage(`file-read-${match[1]}`, "steps", { filename: match[1] });
    }
  }

  // 2. Check files attachment array
  if (Array.isArray(bug.files)) {
    for (const file of bug.files) {
      const ext = file.extension || (file.title ? path.extname(file.title).slice(1) : "");
      if (isImageExtension(ext) || file.type?.startsWith?.("image/")) {
        let fileUrl = file.webPath || file.url;
        if (!fileUrl && file.id) {
          fileUrl = `file-read-${file.id}.${ext || "png"}`;
        }
        if (fileUrl) {
          addImage(fileUrl, "attachment", {
            filename: file.title || `attachment_${file.id}.${ext || "png"}`,
            title: file.title,
          });
        }
      }
    }
  }

  // 3. Check comments in actions
  if (Array.isArray(bug.actions)) {
    for (const act of bug.actions) {
      if (act.comment && typeof act.comment === "string") {
        const commentImgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
        let match;
        while ((match = commentImgRegex.exec(act.comment)) !== null) {
          addImage(match[1], `action_${act.id || "comment"}`);
        }
      }
    }
  }

  return images;
}

export async function downloadImageBuffer(client, url) {
  await client.ensureToken();

  let res = await fetch(url, {
    headers: {
      Token: client.token,
    },
  });

  const contentType = res.headers.get("content-type") || "";
  // If returned login HTML or 401/403, try session cookies
  if (!res.ok || contentType.includes("text/html")) {
    await client.ensureSessionCookies();
    res = await fetch(url, {
      headers: {
        Cookie: client.formatSessionCookies(),
      },
    });
  }

  if (!res.ok) {
    throw new Error(`Failed to download image HTTP ${res.status}: ${url}`);
  }

  const finalContentType = res.headers.get("content-type") || "";
  if (finalContentType.includes("text/html")) {
    throw new Error(`Authentication failed for image: received HTML instead of image from ${url}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function downloadBugImages(client, bug, { outputDir } = {}) {
  const images = extractBugImages(bug, client.baseUrl);
  if (!images.length) {
    return {
      bugId: bug.id,
      bugTitle: bug.title,
      count: 0,
      outputDir: null,
      images: [],
    };
  }

  const targetDir = outputDir
    ? path.resolve(process.cwd(), outputDir)
    : path.resolve(process.cwd(), ".zentao-images", String(bug.id));

  fs.mkdirSync(targetDir, { recursive: true });

  const downloaded = [];
  for (let i = 0; i < images.length; i++) {
    const item = images[i];
    const safeName = item.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const localFileName = `${bug.id}_img_${i + 1}_${safeName}`;
    const localPath = path.join(targetDir, localFileName);

    try {
      const buffer = await downloadImageBuffer(client, item.url);
      fs.writeFileSync(localPath, buffer);
      downloaded.push({
        index: i + 1,
        url: item.url,
        filename: item.filename,
        source: item.source,
        localPath,
        size: buffer.byteLength,
        sizeKb: (buffer.byteLength / 1024).toFixed(1),
        success: true,
      });
    } catch (err) {
      downloaded.push({
        index: i + 1,
        url: item.url,
        filename: item.filename,
        source: item.source,
        localPath: null,
        error: err.message,
        success: false,
      });
    }
  }

  return {
    bugId: bug.id,
    bugTitle: bug.title,
    count: downloaded.length,
    outputDir: targetDir,
    images: downloaded,
  };
}
