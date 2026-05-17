const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const root = __dirname;
const port = Number(process.env.PORT || 4173);

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml"
};

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function runGit(args) {
  return new Promise((resolve) => {
    execFile("git", args, { cwd: root, timeout: 30000 }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        code: error ? error.code : 0
      });
    });
  });
}

async function handleApi(url, req, res) {
  if (url.pathname === "/api/update/check") {
    const remote = await runGit(["remote", "get-url", "origin"]);
    if (!remote.ok) {
      sendJson(res, 200, { ok: false, message: "Aucun depot GitHub n'est configure." });
      return;
    }

    await runGit(["fetch", "origin", "main"]);
    const local = await runGit(["rev-parse", "HEAD"]);
    const upstream = await runGit(["rev-parse", "origin/main"]);
    if (!local.ok || !upstream.ok) {
      sendJson(res, 200, { ok: false, message: "Impossible de lire les commits Git." });
      return;
    }

    sendJson(res, 200, {
      ok: true,
      remote: remote.stdout,
      local: local.stdout,
      upstream: upstream.stdout,
      updateAvailable: local.stdout !== upstream.stdout,
      message: local.stdout === upstream.stdout ? "Logiciel a jour." : "Mise a jour disponible depuis GitHub."
    });
    return;
  }

  if (url.pathname === "/api/update/run") {
    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, message: "POST requis." });
      return;
    }

    const pull = await runGit(["pull", "--ff-only", "origin", "main"]);
    sendJson(res, 200, {
      ok: pull.ok,
      message: pull.ok ? "Mise a jour appliquee. Relance le logiciel si l'interface ne change pas." : "Mise a jour impossible.",
      output: pull.stdout || pull.stderr
    });
    return;
  }

  sendJson(res, 404, { ok: false, message: "API inconnue." });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  if (url.pathname.startsWith("/api/")) {
    handleApi(url, req, res).catch((error) => sendJson(res, 500, { ok: false, message: error.message }));
    return;
  }

  const safePath = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(root, safePath === path.sep ? "index.html" : safePath);

  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    res.writeHead(200, { "Content-Type": types[path.extname(filePath).toLowerCase()] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(port, () => {
  console.log(`Astro Pano Studio: http://localhost:${port}`);
});
