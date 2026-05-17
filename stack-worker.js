self.onmessage = (event) => {
  const { type, width, height, mode, frames, foregroundOnce, foreground, horizonY, feather = 0, startY = 0, endY = height, vignetteFix = 0 } = event.data;
  if (type !== "stack") return;

  const frameArrays = frames.map((buffer) => new Uint8ClampedArray(buffer));
  const fg = foreground ? new Uint8ClampedArray(foreground) : null;
  const rows = endY - startY;
  const out = new Uint8ClampedArray(width * rows * 4);
  const count = frameArrays.length;
  const cx = width / 2;
  const cy = height / 2;
  const maxDistance = Math.hypot(cx, cy);
  const vignetteStrength = vignetteFix / 100;

  for (let y = startY; y < endY; y += 1) {
    const sourceRow = y * width * 4;
    const targetRow = (y - startY) * width * 4;
    for (let x = 0; x < width * 4; x += 4) {
      const source = sourceRow + x;
      const target = targetRow + x;

      if (mode === "max") {
      let r = 0;
      let g = 0;
      let b = 0;
      for (const frame of frameArrays) {
        const gain = vignetteGain(x / 4, y, cx, cy, maxDistance, vignetteStrength);
        r = Math.max(r, Math.min(255, frame[source] * gain));
        g = Math.max(g, Math.min(255, frame[source + 1] * gain));
        b = Math.max(b, Math.min(255, frame[source + 2] * gain));
      }
      out[target] = r;
      out[target + 1] = g;
      out[target + 2] = b;
    } else {
      let r = 0;
      let g = 0;
      let b = 0;
      for (const frame of frameArrays) {
        const gain = vignetteGain(x / 4, y, cx, cy, maxDistance, vignetteStrength);
        r += Math.min(255, frame[source] * gain);
        g += Math.min(255, frame[source + 1] * gain);
        b += Math.min(255, frame[source + 2] * gain);
      }
      out[target] = r / count;
      out[target + 1] = g / count;
      out[target + 2] = b / count;
    }

      if (foregroundOnce && fg) {
        const soft = Math.max(1, feather);
        const horizonAlpha = clamp((y - (horizonY - soft)) / (soft * 2), 0, 1);
        const fgLum = luma(fg[source], fg[source + 1], fg[source + 2]);
        const objectAlpha = fgLum < 92 ? Math.min(0.95, (92 - fgLum) / 52) : 0;
        const alpha = Math.max(horizonAlpha, objectAlpha);
        if (alpha > 0) {
          out[target] = out[target] * (1 - alpha) + fg[source] * alpha;
          out[target + 1] = out[target + 1] * (1 - alpha) + fg[source + 1] * alpha;
          out[target + 2] = out[target + 2] * (1 - alpha) + fg[source + 2] * alpha;
        }
      }
      out[target + 3] = 255;
    }
  }

  self.postMessage({
    type: "stacked",
    width,
    height,
    startY,
    frameCount: count,
    pixels: out.buffer
  }, [out.buffer]);
};

function vignetteGain(x, y, cx, cy, maxDistance, strength) {
  if (strength <= 0) return 1;
  const distance = Math.hypot(x - cx, y - cy) / maxDistance;
  return 1 + strength * distance * distance * 0.85;
}

function luma(r, g, b) {
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
