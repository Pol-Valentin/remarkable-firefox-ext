const MAX_WIDTH = 1600;
const KEPT_AS_IS = new Set(["image/jpeg", "image/png"]);

export async function fetchImage(url) {
  const response = await fetch(url, { credentials: "omit" });
  if (!response.ok) return null;
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  try {
    if (KEPT_AS_IS.has(blob.type) && bitmap.width <= MAX_WIDTH) {
      return { mediaType: blob.type, data: new Uint8Array(await blob.arrayBuffer()) };
    }
    const scale = Math.min(1, MAX_WIDTH / bitmap.width);
    const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const jpeg = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
    return { mediaType: "image/jpeg", data: new Uint8Array(await jpeg.arrayBuffer()) };
  } finally {
    bitmap.close();
  }
}
