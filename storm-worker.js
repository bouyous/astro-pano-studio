self.onmessage = (event) => {
  const {
    type,
    width,
    height,
    startY = 0,
    endY = height,
    base,
    frames,
    threshold,
    intensity,
    cloudProtection,
    baseDarken
  } = event.data;

  if (type !== "storm") return;

  const baseArray = new Uint8ClampedArray(base);
  const frameArrays = frames.map((buffer) => new Uint8ClampedArray(buffer));
  const rows = endY - startY;
  const out = new Uint8ClampedArray(width * rows * 4);
  const cloudReject = cloudProtection * 26;

  for (let y = startY; y < endY; y += 1) {
    const sourceRow = y * width * 4;
    const targetRow = (y - startY) * width * 4;
    for (let x = 0; x < width * 4; x += 4) {
      const source = sourceRow + x;
      const target = targetRow + x;
      out[target] = baseArray[source] * baseDarken;
      out[target + 1] = baseArray[source + 1] * baseDarken;
      out[target + 2] = baseArray[source + 2] * baseDarken;
      out[target + 3] = 255;

      const baseLum = luma(baseArray[source], baseArray[source + 1], baseArray[source + 2]);
      for (const frame of frameArrays) {
        const frameLum = luma(frame[source], frame[source + 1], frame[source + 2]);
        const delta = frameLum - baseLum;
        const whiteness = Math.max(frame[source], frame[source + 1], frame[source + 2]) - Math.min(frame[source], frame[source + 1], frame[source + 2]);

        if (delta > threshold && whiteness < 92 + cloudReject && frameLum > 80 + threshold * 0.7) {
          out[target] = Math.max(out[target], Math.min(255, frame[source] * intensity));
          out[target + 1] = Math.max(out[target + 1], Math.min(255, frame[source + 1] * intensity));
          out[target + 2] = Math.max(out[target + 2], Math.min(255, frame[source + 2] * intensity));
        }
      }
    }
  }

  self.postMessage({
    type: "storm",
    startY,
    pixels: out.buffer
  }, [out.buffer]);
};

function luma(r, g, b) {
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}
