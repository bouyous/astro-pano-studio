const state = {
  mode: "day",
  files: [],
  rendered: false,
  workerCount: 0,
  workerBusy: false,
  gpu: null,
  securityToken: null
};

const rawExtensions = new Set(["arw", "cr2", "cr3", "nef", "raf", "dng", "orf", "rw2", "raw"]);
const supportedPreviewTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp"]);

const els = {
  fileInput: document.querySelector("#fileInput"),
  filmstrip: document.querySelector("#filmstrip"),
  preview: document.querySelector("#preview"),
  emptyState: document.querySelector("#emptyState"),
  status: document.querySelector("#status"),
  loadedCount: document.querySelector("#loadedCount"),
  renderBtn: document.querySelector("#renderBtn"),
  downloadBtn: document.querySelector("#downloadBtn"),
  checkUpdateBtn: document.querySelector("#checkUpdateBtn"),
  runUpdateBtn: document.querySelector("#runUpdateBtn"),
  updateStatus: document.querySelector("#updateStatus"),
  clearBtn: document.querySelector("#clearBtn"),
  sortBtn: document.querySelector("#sortBtn"),
  dayMode: document.querySelector("#dayMode"),
  nightMode: document.querySelector("#nightMode"),
  stormMode: document.querySelector("#stormMode"),
  dayControls: document.querySelector("#dayControls"),
  nightControls: document.querySelector("#nightControls"),
  stormControls: document.querySelector("#stormControls"),
  workspaceTitle: document.querySelector("#workspaceTitle"),
  overlap: document.querySelector("#overlap"),
  exposure: document.querySelector("#exposure"),
  outputHeight: document.querySelector("#outputHeight"),
  projection: document.querySelector("#projection"),
  nightPreset: document.querySelector("#nightPreset"),
  stackMode: document.querySelector("#stackMode"),
  autoNight: document.querySelector("#autoNight"),
  driftX: document.querySelector("#driftX"),
  driftY: document.querySelector("#driftY"),
  horizon: document.querySelector("#horizon"),
  foregroundOnce: document.querySelector("#foregroundOnce"),
  foregroundStyle: document.querySelector("#foregroundStyle"),
  foregroundLight: document.querySelector("#foregroundLight"),
  lightningThreshold: document.querySelector("#lightningThreshold"),
  lightningIntensity: document.querySelector("#lightningIntensity"),
  cloudProtection: document.querySelector("#cloudProtection"),
  stormBaseDarken: document.querySelector("#stormBaseDarken"),
  vignetteFix: document.querySelector("#vignetteFix"),
  bloom: document.querySelector("#bloom")
};

const ctx = els.preview.getContext("2d", { willReadFrequently: true });
const gpuStatus = document.querySelector("#gpuStatus");
const workerStatus = document.querySelector("#workerStatus");

function createGpuRenderer() {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2", { premultipliedAlpha: false, preserveDrawingBuffer: true });
  if (!gl) return null;

  const vertex = `#version 300 es
    in vec2 a_position;
    in vec2 a_texcoord;
    out vec2 v_texcoord;
    void main() {
      v_texcoord = a_texcoord;
      gl_Position = vec4(a_position, 0.0, 1.0);
    }`;
  const fragment = `#version 300 es
    precision highp float;
    uniform sampler2D u_image;
    uniform float u_alpha;
    uniform float u_exposure;
    in vec2 v_texcoord;
    out vec4 outColor;
    void main() {
      vec4 color = texture(u_image, v_texcoord);
      color.rgb *= u_exposure;
      outColor = vec4(color.rgb, color.a * u_alpha);
    }`;

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  }

  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;

  const vao = gl.createVertexArray();
  const buffer = gl.createBuffer();
  const posLoc = gl.getAttribLocation(program, "a_position");
  const texLoc = gl.getAttribLocation(program, "a_texcoord");
  const alphaLoc = gl.getUniformLocation(program, "u_alpha");
  const exposureLoc = gl.getUniformLocation(program, "u_exposure");

  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(texLoc);
  gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 16, 8);

  function drawImage(image, x, y, width, height, outputWidth, outputHeight, alpha, exposure) {
    const left = (x / outputWidth) * 2 - 1;
    const right = ((x + width) / outputWidth) * 2 - 1;
    const top = 1 - (y / outputHeight) * 2;
    const bottom = 1 - ((y + height) / outputHeight) * 2;
    const vertices = new Float32Array([
      left, top, 0, 0,
      right, top, 1, 0,
      left, bottom, 0, 1,
      left, bottom, 0, 1,
      right, top, 1, 0,
      right, bottom, 1, 1
    ]);

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STREAM_DRAW);
    gl.uniform1f(alphaLoc, alpha);
    gl.uniform1f(exposureLoc, exposure);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.deleteTexture(texture);
  }

  return {
    canvas,
    renderDay(images, scaled, outputWidth, outputHeight, overlap, exposurePercent) {
      canvas.width = Math.max(1, Math.round(outputWidth));
      canvas.height = Math.max(1, Math.round(outputHeight));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.clearColor(0.02, 0.025, 0.03, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      let x = 0;
      scaled.forEach((item, index) => {
        const alpha = index === 0 ? 1 : 0.86;
        drawImage(images[index], x, 0, item.width, item.height, outputWidth, outputHeight, alpha, exposurePercent / 100);
        x += item.width * (1 - overlap);
      });

      gl.disable(gl.BLEND);
    }
  };
}

function initEngines() {
  try {
    state.gpu = createGpuRenderer();
  } catch (error) {
    state.gpu = null;
  }

  if (state.gpu) {
    gpuStatus.classList.add("ready");
    gpuStatus.textContent = "GPU pret";
  } else {
    gpuStatus.classList.add("off");
    gpuStatus.textContent = "CPU";
  }

  if (window.Worker) {
    state.workerCount = Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
    workerStatus.classList.add("ready");
    workerStatus.textContent = `${state.workerCount} threads`;
  } else {
    workerStatus.classList.add("off");
    workerStatus.textContent = "CPU";
  }
}

function extensionOf(name) {
  return name.split(".").pop().toLowerCase();
}

function isLikelyRaw(file) {
  return rawExtensions.has(extensionOf(file.name));
}

function canPreview(file) {
  return supportedPreviewTypes.has(file.type);
}

function loadImage(file) {
  return new Promise((resolve) => {
    const item = {
      id: crypto.randomUUID(),
      name: file.name,
      file,
      raw: isLikelyRaw(file),
      previewable: canPreview(file),
      image: null,
      url: null,
      error: null
    };

    if (!item.previewable) {
      item.error = item.raw ? "RAW a convertir" : "Format non lisible";
      resolve(item);
      return;
    }

    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      item.image = image;
      item.url = url;
      resolve(item);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      item.error = "Lecture impossible";
      resolve(item);
    };
    image.src = url;
  });
}

async function addFiles(fileList) {
  const loaded = await Promise.all(Array.from(fileList).map(loadImage));
  state.files.push(...loaded);
  state.rendered = false;
  renderFileList();
  updateStatus();
  clearCanvas();
}

function readableFiles() {
  return state.files.filter((item) => item.image);
}

function updateStatus(message) {
  const usable = readableFiles().length;
  const raw = state.files.filter((item) => item.raw).length;
  els.loadedCount.textContent = usable;

  if (message) {
    els.status.textContent = message;
    return;
  }

  if (!state.files.length) {
    els.status.textContent = "Importe des images pour commencer.";
  } else if (!usable && raw) {
    els.status.textContent = "RAW importes: convertis-les en TIFF 16 bits ou JPEG pleine taille pour les assembler ici.";
  } else if (raw) {
    els.status.textContent = `${usable} image(s) lisible(s), ${raw} RAW a preparer.`;
  } else {
    els.status.textContent = `${usable} image(s) pretes pour l'assemblage.`;
  }
}

function renderFileList() {
  els.filmstrip.innerHTML = "";
  for (const item of state.files) {
    const card = document.createElement("article");
    card.className = "thumb";

    if (item.image) {
      const img = document.createElement("img");
      img.src = item.url;
      img.alt = item.name;
      card.appendChild(img);
    } else {
      const box = document.createElement("div");
      box.className = "raw-box";
      box.textContent = item.raw ? "RAW" : "FICHIER";
      card.appendChild(box);
    }

    const label = document.createElement("p");
    label.textContent = item.name;
    label.title = item.error || item.name;
    card.appendChild(label);
    els.filmstrip.appendChild(card);
  }
}

function bindOutput(range, suffix = "") {
  const output = document.querySelector(`#${range.id}Value`);
  const update = () => {
    output.textContent = `${range.value}${suffix}`;
  };
  range.addEventListener("input", update);
  update();
}

function refreshOutputs() {
  document.querySelector("#overlapValue").textContent = `${els.overlap.value}%`;
  document.querySelector("#exposureValue").textContent = `${els.exposure.value}%`;
  document.querySelector("#horizonValue").textContent = `${els.horizon.value}%`;
  document.querySelector("#vignetteFixValue").textContent = `${els.vignetteFix.value}%`;
  document.querySelector("#bloomValue").textContent = `${els.bloom.value}%`;
  document.querySelector("#foregroundLightValue").textContent = `${els.foregroundLight.value}%`;
  document.querySelector("#lightningThresholdValue").textContent = `${els.lightningThreshold.value}`;
  document.querySelector("#lightningIntensityValue").textContent = `${els.lightningIntensity.value}%`;
  document.querySelector("#cloudProtectionValue").textContent = `${els.cloudProtection.value}%`;
  document.querySelector("#stormBaseDarkenValue").textContent = `${els.stormBaseDarken.value}%`;
  document.querySelector("#outputHeightValue").textContent = `${els.outputHeight.value} px`;
  document.querySelector("#driftXValue").textContent = `${els.driftX.value} px`;
  document.querySelector("#driftYValue").textContent = `${els.driftY.value} px`;
}

function setMode(mode) {
  state.mode = mode;
  els.dayMode.classList.toggle("active", mode === "day");
  els.nightMode.classList.toggle("active", mode === "night");
  els.stormMode.classList.toggle("active", mode === "storm");
  els.dayControls.classList.toggle("hidden", mode !== "day");
  els.nightControls.classList.toggle("hidden", mode !== "night");
  els.stormControls.classList.toggle("hidden", mode !== "storm");
  els.workspaceTitle.textContent = {
    day: "Panorama jour",
    night: "Ciel etoile avec premier plan unique",
    storm: "Orage avec eclairs multiples"
  }[mode];
  state.rendered = false;
  clearCanvas();
  const messages = {
    day: "Mode jour: assemble une rangee panoramique.",
    night: "Mode nuit: empile le ciel et garde un seul premier plan.",
    storm: "Mode orage: garde le decor fixe et additionne les eclairs visibles de la session."
  };
  updateStatus(messages[mode]);
}

function resizeCanvas(width, height) {
  els.preview.width = Math.max(1, Math.round(width));
  els.preview.height = Math.max(1, Math.round(height));
}

function clearCanvas() {
  resizeCanvas(1200, 700);
  ctx.clearRect(0, 0, els.preview.width, els.preview.height);
  els.emptyState.classList.toggle("hidden", state.files.length > 0);
  els.downloadBtn.disabled = true;
}

function drawWithExposure(image, x, y, width, height, exposure) {
  ctx.save();
  ctx.filter = `brightness(${exposure}%)`;
  ctx.drawImage(image, x, y, width, height);
  ctx.restore();
}

function applyVignetteToCanvas(strength) {
  if (strength <= 0) return;
  const image = ctx.getImageData(0, 0, els.preview.width, els.preview.height);
  const { width, height, data } = image;
  const cx = width / 2;
  const cy = height / 2;
  const maxDistance = Math.hypot(cx, cy);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const distance = Math.hypot(x - cx, y - cy) / maxDistance;
      const gain = 1 + (strength / 100) * distance * distance * 0.85;
      data[i] = Math.min(255, data[i] * gain);
      data[i + 1] = Math.min(255, data[i + 1] * gain);
      data[i + 2] = Math.min(255, data[i + 2] * gain);
    }
  }

  ctx.putImageData(image, 0, 0);
}

function applyAutoNight() {
  const image = ctx.getImageData(0, 0, els.preview.width, els.preview.height);
  const data = image.data;
  const values = [];

  for (let i = 0; i < data.length; i += 16) {
    values.push((data[i] + data[i + 1] + data[i + 2]) / 3);
  }

  values.sort((a, b) => a - b);
  const black = values[Math.floor(values.length * 0.01)] || 0;
  const white = values[Math.floor(values.length * 0.995)] || 255;
  const range = Math.max(24, white - black);

  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c += 1) {
      let value = (data[i + c] - black) * 255 / range;
      value = Math.max(0, Math.min(255, value));
      data[i + c] = Math.pow(value / 255, 0.88) * 255;
    }
  }

  ctx.putImageData(image, 0, 0);
}

function applyBloom(amount) {
  if (amount <= 0) return;
  const copy = document.createElement("canvas");
  copy.width = els.preview.width;
  copy.height = els.preview.height;
  copy.getContext("2d").drawImage(els.preview, 0, 0);

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = Math.min(0.45, amount / 160);
  ctx.filter = `blur(${Math.max(1, Math.round(amount / 4))}px)`;
  ctx.drawImage(copy, 0, 0);
  ctx.restore();
}

function applyProjection(projection) {
  if (projection === "rectilinear") return;

  const source = document.createElement("canvas");
  source.width = els.preview.width;
  source.height = els.preview.height;
  source.getContext("2d").drawImage(els.preview, 0, 0);
  ctx.clearRect(0, 0, els.preview.width, els.preview.height);
  ctx.fillStyle = "#050607";
  ctx.fillRect(0, 0, els.preview.width, els.preview.height);

  const slices = Math.min(900, els.preview.width);
  const sliceWidth = els.preview.width / slices;
  const center = els.preview.width / 2;
  const maxAngle = projection === "spherical" ? 1.08 : 0.82;

  for (let s = 0; s < slices; s += 1) {
    const sx = s * sliceWidth;
    const nx = (sx + sliceWidth / 2 - center) / center;
    const curve = Math.cos(nx * maxAngle);
    const heightScale = projection === "spherical" ? 0.82 + 0.18 * curve : 0.72 + 0.28 * curve;
    const drawHeight = els.preview.height * heightScale;
    const dy = (els.preview.height - drawHeight) / 2;
    ctx.drawImage(source, sx, 0, sliceWidth + 1, els.preview.height, sx, dy, sliceWidth + 1, drawHeight);
  }
}

function renderDay() {
  const images = readableFiles().map((item) => item.image);
  if (!images.length) {
    updateStatus("Aucune image lisible. Convertis les RAW avant l'assemblage.");
    return;
  }

  const targetHeight = Number(els.outputHeight.value);
  const scaled = images.map((image) => {
    const scale = targetHeight / image.naturalHeight;
    return {
      image,
      width: image.naturalWidth * scale,
      height: targetHeight
    };
  });
  const overlap = Number(els.overlap.value) / 100;
  const totalWidth = scaled.reduce((sum, item, index) => {
    const step = index === 0 ? item.width : item.width * (1 - overlap);
    return sum + step;
  }, 0);

  const exposure = Number(els.exposure.value);
  resizeCanvas(totalWidth, targetHeight);
  ctx.clearRect(0, 0, els.preview.width, els.preview.height);

  if (state.gpu) {
    state.gpu.renderDay(images, scaled, totalWidth, targetHeight, overlap, exposure);
    ctx.drawImage(state.gpu.canvas, 0, 0);
  } else {
    ctx.fillStyle = "#050607";
    ctx.fillRect(0, 0, els.preview.width, els.preview.height);
    let x = 0;
    scaled.forEach((item, index) => {
      drawWithExposure(item.image, x, 0, item.width, item.height, exposure);
      x += item.width * (1 - overlap);
      if (index > 0) ctx.globalAlpha = 1;
    });
  }

  applyProjection(els.projection.value);
  applyVignetteToCanvas(Number(els.vignetteFix.value));
  applyBloom(Number(els.bloom.value));
  state.rendered = true;
  els.downloadBtn.disabled = false;
  els.emptyState.classList.add("hidden");
  updateStatus(`Panorama ${els.projection.value} cree avec ${images.length} image(s) via ${state.gpu ? "GPU WebGL2" : "CPU Canvas"}.`);
}

function imageToCanvasData(image, width, height, dx = 0, dy = 0) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const c = canvas.getContext("2d", { willReadFrequently: true });
  c.fillStyle = "#000";
  c.fillRect(0, 0, width, height);
  c.drawImage(image, dx, dy, width, height);
  return c.getImageData(0, 0, width, height);
}

function renderNight() {
  const images = readableFiles().map((item) => item.image);
  if (!images.length) {
    updateStatus("Aucune image lisible. Convertis les RAW avant l'empilement.");
    return;
  }

  const width = Math.min(2200, images[0].naturalWidth);
  const scale = width / images[0].naturalWidth;
  const height = Math.round(images[0].naturalHeight * scale);
  const horizonY = Math.round(height * Number(els.horizon.value) / 100);
  const driftX = Number(els.driftX.value);
  const driftY = Number(els.driftY.value);
  const mode = els.stackMode.value;
  const vignetteFix = Number(els.vignetteFix.value);

  resizeCanvas(width, height);
  const frames = images.map((image, index) => {
    const dx = -driftX * index;
    const dy = -driftY * index;
    return imageToCanvasData(image, width, height, dx, dy).data.buffer;
  });

  if (state.workerCount > 0) {
    renderNightWithWorkers(width, height, mode, frames, horizonY, images.length, els.foregroundOnce.checked ? imageToCanvasData(images[0], width, height).data.buffer : null, vignetteFix);
    return;
  }

  stackOnMainThread(width, height, mode, frames.map((buffer) => new Uint8ClampedArray(buffer)), horizonY, images);
}

function renderStorm() {
  const images = readableFiles().map((item) => item.image);
  if (images.length < 2) {
    updateStatus("Mode orage: importe au moins deux images prises sur trepied.");
    return;
  }

  const width = Math.min(2400, images[0].naturalWidth);
  const scale = width / images[0].naturalWidth;
  const height = Math.round(images[0].naturalHeight * scale);
  const threshold = Number(els.lightningThreshold.value);
  const intensity = Number(els.lightningIntensity.value) / 100;
  const cloudProtection = Number(els.cloudProtection.value) / 100;
  const baseDarken = 1 - Number(els.stormBaseDarken.value) / 100;

  resizeCanvas(width, height);
  const base = imageToCanvasData(images[0], width, height);
  const out = new Uint8ClampedArray(base.data);

  for (let i = 0; i < out.length; i += 4) {
    out[i] *= baseDarken;
    out[i + 1] *= baseDarken;
    out[i + 2] *= baseDarken;
  }

  let lightningPixels = 0;
  for (let frameIndex = 1; frameIndex < images.length; frameIndex += 1) {
    const frame = imageToCanvasData(images[frameIndex], width, height).data;
    for (let i = 0; i < out.length; i += 4) {
      const baseLum = luma(base.data[i], base.data[i + 1], base.data[i + 2]);
      const frameLum = luma(frame[i], frame[i + 1], frame[i + 2]);
      const delta = frameLum - baseLum;
      const whiteness = Math.max(frame[i], frame[i + 1], frame[i + 2]) - Math.min(frame[i], frame[i + 1], frame[i + 2]);
      const cloudReject = cloudProtection * 26;

      if (delta > threshold && whiteness < 92 + cloudReject && frameLum > 80 + threshold * 0.7) {
        out[i] = Math.max(out[i], Math.min(255, frame[i] * intensity));
        out[i + 1] = Math.max(out[i + 1], Math.min(255, frame[i + 1] * intensity));
        out[i + 2] = Math.max(out[i + 2], Math.min(255, frame[i + 2] * intensity));
        lightningPixels += 1;
      }
    }
  }

  ctx.putImageData(new ImageData(out, width, height), 0, 0);
  applyVignetteToCanvas(Number(els.vignetteFix.value));
  applyBloom(Math.max(Number(els.bloom.value), 10));
  state.rendered = true;
  els.downloadBtn.disabled = false;
  els.emptyState.classList.add("hidden");
  updateStatus(`Photo d'orage creee avec ${images.length} images, ${Math.round(lightningPixels / 1000)}k pixels d'eclairs fusionnes.`);
}

function luma(r, g, b) {
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

function renderNightWithWorkers(width, height, mode, frames, horizonY, frameCount, foreground, vignetteFix) {
  const workerTotal = Math.min(state.workerCount, height);
  const chunkHeight = Math.ceil(height / workerTotal);
  const result = new Uint8ClampedArray(width * height * 4);
  let completed = 0;
  let failed = false;

  state.workerBusy = true;
  els.renderBtn.disabled = true;
  updateStatus(`Empilement nuit avec ${workerTotal} threads et ${frameCount} frame(s)...`);

  for (let index = 0; index < workerTotal; index += 1) {
    const startY = index * chunkHeight;
    const endY = Math.min(height, startY + chunkHeight);
    const worker = new Worker("stack-worker.js");

    worker.onmessage = (event) => {
      const { pixels, startY: returnedStartY } = event.data;
      result.set(new Uint8ClampedArray(pixels), returnedStartY * width * 4);
      completed += 1;
      worker.terminate();

      if (completed === workerTotal && !failed) {
        state.workerBusy = false;
        els.renderBtn.disabled = false;
        ctx.putImageData(new ImageData(result, width, height), 0, 0);
        if (els.autoNight.checked) applyAutoNight();
        applyForegroundEffects(horizonY);
        applyBloom(Number(els.bloom.value));
        state.rendered = true;
        els.downloadBtn.disabled = false;
        els.emptyState.classList.add("hidden");
        updateStatus(`Image nuit creee avec ${frameCount} frame(s) sur ${workerTotal} threads.`);
      }
    };

    worker.onerror = () => {
      failed = true;
      state.workerBusy = false;
      els.renderBtn.disabled = false;
      worker.terminate();
      updateStatus("Erreur pendant l'empilement multi-thread. Essaie avec moins d'images ou des fichiers plus petits.");
    };

    worker.postMessage({
      type: "stack",
      width,
      height,
      mode,
      frames,
      startY,
      endY,
      horizonY,
      foregroundOnce: Boolean(foreground),
      foreground,
      vignetteFix
    });
  }
}

function stackOnMainThread(width, height, mode, frameArrays, horizonY, images) {
  const out = computeStack(width, height, mode, frameArrays);
  ctx.putImageData(new ImageData(out, width, height), 0, 0);

  if (els.foregroundOnce.checked && images) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, horizonY, width, height - horizonY);
    ctx.clip();
    ctx.drawImage(images[0], 0, 0, width, height);
    ctx.restore();
    const fade = ctx.createLinearGradient(0, horizonY - 42, 0, horizonY + 42);
    fade.addColorStop(0, "rgba(0,0,0,0)");
    fade.addColorStop(1, "rgba(0,0,0,0.26)");
    ctx.fillStyle = fade;
    ctx.fillRect(0, horizonY - 42, width, 84);
  }

  if (els.autoNight.checked) applyAutoNight();
  applyForegroundEffects(horizonY);
  applyBloom(Number(els.bloom.value));
  state.rendered = true;
  els.downloadBtn.disabled = false;
  els.emptyState.classList.add("hidden");
  updateStatus(`Image nuit creee en CPU principal avec ${frameArrays.length} frame(s).`);
}

function applyForegroundEffects(horizonY) {
  const style = els.foregroundStyle.value;
  const light = Number(els.foregroundLight.value) / 100;

  if (style.includes("relight") && light > 0) {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const glow = ctx.createRadialGradient(
      els.preview.width * 0.5,
      els.preview.height * 0.92,
      10,
      els.preview.width * 0.5,
      els.preview.height * 0.92,
      els.preview.width * 0.55
    );
    glow.addColorStop(0, `rgba(255,214,158,${0.36 * light})`);
    glow.addColorStop(0.48, `rgba(127,178,255,${0.13 * light})`);
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, horizonY - 80, els.preview.width, els.preview.height - horizonY + 120);
    ctx.restore();
  }

  if (style.includes("preserve-silhouette")) {
    updateStatus("Silhouette protegee: elle doit etre presente dans la premiere image RAW/TIFF, aucune personne n'est ajoutee.");
  }
}

function applyPreset(name) {
  const presets = {
    neutral: { stack: "max", auto: true, vignette: 35, bloom: 18, light: 26, foreground: "normal" },
    "milky-detail": { stack: "max", auto: true, vignette: 46, bloom: 22, light: 18, foreground: "normal" },
    "cold-blue": { stack: "average", auto: true, vignette: 34, bloom: 14, light: 10, foreground: "normal" },
    "natural-soft": { stack: "average", auto: true, vignette: 25, bloom: 10, light: 20, foreground: "normal" },
    "moon-foreground": { stack: "average", auto: true, vignette: 30, bloom: 12, light: 62, foreground: "relight" },
    "human-silhouette": { stack: "max", auto: true, vignette: 42, bloom: 24, light: 34, foreground: "relight-preserve-silhouette" }
  };
  const preset = presets[name] || presets.neutral;
  els.stackMode.value = preset.stack;
  els.autoNight.checked = preset.auto;
  els.vignetteFix.value = preset.vignette;
  els.bloom.value = preset.bloom;
  els.foregroundLight.value = preset.light;
  els.foregroundStyle.value = preset.foreground;
  refreshOutputs();
  updateStatus(`Preset nocturne applique: ${els.nightPreset.options[els.nightPreset.selectedIndex].text}.`);
}

function computeStack(width, height, mode, frames) {
  const out = new Uint8ClampedArray(width * height * 4);
  const count = frames.length;
  for (let i = 0; i < out.length; i += 4) {
    if (mode === "max") {
      let r = 0;
      let g = 0;
      let b = 0;
      for (const frame of frames) {
        r = Math.max(r, frame[i]);
        g = Math.max(g, frame[i + 1]);
        b = Math.max(b, frame[i + 2]);
      }
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
    } else {
      let r = 0;
      let g = 0;
      let b = 0;
      for (const frame of frames) {
        r += frame[i];
        g += frame[i + 1];
        b += frame[i + 2];
      }
      out[i] = r / count;
      out[i + 1] = g / count;
      out[i + 2] = b / count;
    }
    out[i + 3] = 255;
  }
  return out;
}

function downloadPng() {
  if (!state.rendered) return;
  const link = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const prefix = {
    day: "panorama-jour",
    night: "astro-pano",
    storm: "orage-eclairs"
  }[state.mode];
  link.download = `${prefix}-${stamp}.png`;
  link.href = els.preview.toDataURL("image/png");
  link.click();
}

function renderCurrentMode() {
  if (state.mode === "day") renderDay();
  if (state.mode === "night") renderNight();
  if (state.mode === "storm") renderStorm();
}

async function checkForUpdate() {
  els.checkUpdateBtn.disabled = true;
  els.updateStatus.textContent = "Verification GitHub...";
  try {
    const response = await secureFetch("/api/update/check");
    const data = await response.json();
    els.runUpdateBtn.disabled = !data.ok || !data.updateAvailable;
    els.updateStatus.textContent = data.message || "Verification terminee.";
  } catch (error) {
    els.updateStatus.textContent = "Verification impossible. Lance le logiciel via le serveur local.";
  } finally {
    els.checkUpdateBtn.disabled = false;
  }
}

async function runUpdate() {
  els.runUpdateBtn.disabled = true;
  els.updateStatus.textContent = "Mise a jour en cours...";
  try {
    const response = await secureFetch("/api/update/run", { method: "POST" });
    const data = await response.json();
    els.updateStatus.textContent = data.message || "Mise a jour terminee.";
  } catch (error) {
    els.updateStatus.textContent = "Mise a jour impossible depuis l'interface.";
  }
}

async function getSecurityToken() {
  if (state.securityToken) return state.securityToken;
  const response = await fetch("/api/security/session", {
    cache: "no-store",
    credentials: "same-origin"
  });
  const data = await response.json();
  if (!data.ok || !data.token) {
    throw new Error("Session locale non autorisee");
  }
  state.securityToken = data.token;
  return state.securityToken;
}

async function secureFetch(url, options = {}) {
  const token = await getSecurityToken();
  return fetch(url, {
    ...options,
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      ...(options.headers || {}),
      "X-Astro-Token": token
    }
  });
}

els.fileInput.addEventListener("change", (event) => addFiles(event.target.files));
els.renderBtn.addEventListener("click", renderCurrentMode);
els.downloadBtn.addEventListener("click", downloadPng);
els.dayMode.addEventListener("click", () => setMode("day"));
els.nightMode.addEventListener("click", () => setMode("night"));
els.stormMode.addEventListener("click", () => setMode("storm"));
els.checkUpdateBtn.addEventListener("click", checkForUpdate);
els.runUpdateBtn.addEventListener("click", runUpdate);
els.nightPreset.addEventListener("change", () => applyPreset(els.nightPreset.value));
els.sortBtn.addEventListener("click", () => {
  state.files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  renderFileList();
  updateStatus("Photos triees par nom.");
});
els.clearBtn.addEventListener("click", () => {
  state.files.forEach((item) => item.url && URL.revokeObjectURL(item.url));
  state.files = [];
  state.rendered = false;
  renderFileList();
  clearCanvas();
  updateStatus();
});

for (const range of [els.overlap, els.exposure, els.horizon, els.vignetteFix, els.bloom, els.foregroundLight, els.lightningIntensity, els.cloudProtection, els.stormBaseDarken]) bindOutput(range, "%");
bindOutput(els.lightningThreshold);
bindOutput(els.outputHeight, " px");
bindOutput(els.driftX, " px");
bindOutput(els.driftY, " px");

clearCanvas();
initEngines();
