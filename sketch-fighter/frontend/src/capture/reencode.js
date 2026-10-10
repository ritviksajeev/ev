// Re-encode a camera photo before upload: applies EXIF rotation, turns HEIC
// into JPEG and shrinks it to a few hundred KB (long side 1280, quality 0.85).
export async function reencode(file, maxSide = 1280, quality = 0.85) {
  const src = await decode(file);
  const k = Math.min(1, maxSide / Math.max(src.width, src.height));
  const w = Math.round(src.width * k);
  const h = Math.round(src.height * k);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(src, 0, 0, w, h);
  src.close?.();
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the photo'))), 'image/jpeg', quality));
  return { blob, width: w, height: h, url: URL.createObjectURL(blob) };
}

async function decode(file) {
  if (window.createImageBitmap) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Older Safari rejects the options bag; <img> applies EXIF rotation itself.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new Error("That file doesn't look like a photo");
  } finally {
    URL.revokeObjectURL(url);
  }
}
