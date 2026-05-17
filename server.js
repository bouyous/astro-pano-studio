const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");

const root = __dirname;
const port = Number(process.env.PORT || 4173);
const host = "127.0.0.1";
const sessionToken = crypto.randomBytes(32).toString("base64url");
const trustedRepoPattern = /github\.com[/:]bouyous\/astro-pano-studio(\.git)?$/i;

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
  res.writeHead(status, secureHeaders({ "Content-Type": "application/json; charset=utf-8" }));
  res.end(JSON.stringify(payload));
}

function secureHeaders(extra = {}) {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; worker-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    ...extra
  };
}

function isTrustedRequest(req) {
  const hostHeader = req.headers.host || "";
  const allowedHosts = new Set([`${host}:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  if (!allowedHosts.has(hostHeader)) return false;

  const origin = req.headers.origin;
  if (origin && !isTrustedUrl(origin, allowedHosts)) return false;

  const referer = req.headers.referer;
  if (referer && !isTrustedUrl(referer, allowedHosts)) return false;

  return true;
}

function isTrustedUrl(value, allowedHosts) {
  try {
    return allowedHosts.has(new URL(value).host);
  } catch {
    return false;
  }
}

function hasValidToken(req) {
  return req.headers["x-astro-token"] === sessionToken;
}

async function getTrustedRemote() {
  const remote = await runGit(["remote", "get-url", "origin"]);
  if (!remote.ok) {
    return { ok: false, message: "Aucun depot GitHub n'est configure." };
  }

  if (!trustedRepoPattern.test(remote.stdout)) {
    return { ok: false, message: "Depot distant non autorise pour les mises a jour.", remote: remote.stdout };
  }

  return { ok: true, remote: remote.stdout };
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
  if (!isTrustedRequest(req)) {
    sendJson(res, 403, { ok: false, message: "Requete locale non autorisee." });
    return;
  }

  if (url.pathname === "/api/security/session") {
    sendJson(res, 200, { ok: true, token: sessionToken });
    return;
  }

  if (!hasValidToken(req)) {
    sendJson(res, 403, { ok: false, message: "Token de session invalide." });
    return;
  }

  if (url.pathname === "/api/update/check") {
    const remote = await getTrustedRemote();
    if (!remote.ok) {
      sendJson(res, 200, remote);
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
      remote: remote.remote,
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

    const remote = await getTrustedRemote();
    if (!remote.ok) {
      sendJson(res, 200, remote);
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
  if (!["GET", "HEAD", "POST"].includes(req.method)) {
    sendJson(res, 405, { ok: false, message: "Methode non autorisee." });
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    handleApi(url, req, res).catch((error) => sendJson(res, 500, { ok: false, message: error.message }));
    return;
  }

  const relativePath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname).replace(/^[/\\]+/, "");
  const filePath = path.resolve(root, relativePath);

  if (!filePath.startsWith(root + path.sep)) {
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

    res.writeHead(200, secureHeaders({ "Content-Type": types[path.extname(filePath).toLowerCase()] || "application/octet-stream" }));
    res.end(data);
  });
});

server.listen(port, host, () => {
  console.log(`Astro Pano Studio: http://${host}:${port}`);
});
