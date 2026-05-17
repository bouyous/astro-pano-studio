using System.Diagnostics;
using System.Net;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;

var root = FindAppRoot(AppContext.BaseDirectory);
var port = GetPort();
var host = "127.0.0.1";
var sessionToken = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
var prefix = $"http://{host}:{port}/";
using var listener = new HttpListener();
listener.Prefixes.Add(prefix);

try
{
    listener.Start();
}
catch (HttpListenerException)
{
    port += 1;
    prefix = $"http://{host}:{port}/";
    listener.Prefixes.Clear();
    listener.Prefixes.Add(prefix);
    listener.Start();
}

Console.WriteLine($"Astro Pano Studio: {prefix}");
OpenBrowser(prefix);

while (listener.IsListening)
{
    var context = await listener.GetContextAsync();
    _ = Task.Run(() => HandleRequest(context, root, port, sessionToken));
}

static string FindAppRoot(string start)
{
    var dir = new DirectoryInfo(start);
    while (dir is not null)
    {
        if (File.Exists(Path.Combine(dir.FullName, "index.html")) && File.Exists(Path.Combine(dir.FullName, "app.js")))
        {
            return dir.FullName;
        }

        dir = dir.Parent;
    }

    return start;
}

static int GetPort()
{
    var value = Environment.GetEnvironmentVariable("PORT");
    return int.TryParse(value, out var port) ? port : 4173;
}

static async Task HandleRequest(HttpListenerContext context, string root, int port, string sessionToken)
{
    try
    {
        AddSecurityHeaders(context.Response);
        if (!IsAllowedMethod(context.Request))
        {
            await SendJson(context.Response, 405, new { ok = false, message = "Methode non autorisee." });
            return;
        }

        var path = context.Request.Url?.AbsolutePath ?? "/";
        if (path.StartsWith("/api/", StringComparison.OrdinalIgnoreCase))
        {
            await HandleApi(context, path, root, port, sessionToken);
            return;
        }

        await ServeFile(context, root, path);
    }
    catch (Exception error)
    {
        await SendJson(context.Response, 500, new { ok = false, message = error.Message });
    }
}

static async Task HandleApi(HttpListenerContext context, string path, string root, int port, string sessionToken)
{
    if (!IsTrustedRequest(context.Request, port))
    {
        await SendJson(context.Response, 403, new { ok = false, message = "Requete locale non autorisee." });
        return;
    }

    if (path.Equals("/api/security/session", StringComparison.OrdinalIgnoreCase))
    {
        await SendJson(context.Response, 200, new { ok = true, token = sessionToken });
        return;
    }

    if (!HasValidToken(context.Request, sessionToken))
    {
        await SendJson(context.Response, 403, new { ok = false, message = "Token de session invalide." });
        return;
    }

    if (path.Equals("/api/update/check", StringComparison.OrdinalIgnoreCase))
    {
        var remote = await GetTrustedRemote(root);
        if (!remote.Ok)
        {
            await SendJson(context.Response, 200, new { ok = false, message = remote.Output });
            return;
        }

        await RunGit(root, "fetch", "origin", "main");
        var local = await RunGit(root, "rev-parse", "HEAD");
        var upstream = await RunGit(root, "rev-parse", "origin/main");

        await SendJson(context.Response, 200, new
        {
            ok = local.Ok && upstream.Ok,
            remote = remote.Output,
            local = local.Output,
            upstream = upstream.Output,
            updateAvailable = local.Output != upstream.Output,
            message = local.Output == upstream.Output ? "Logiciel a jour." : "Mise a jour disponible depuis GitHub."
        });
        return;
    }

    if (path.Equals("/api/update/run", StringComparison.OrdinalIgnoreCase))
    {
        if (!context.Request.HttpMethod.Equals("POST", StringComparison.OrdinalIgnoreCase))
        {
            await SendJson(context.Response, 405, new { ok = false, message = "POST requis." });
            return;
        }

        var remote = await GetTrustedRemote(root);
        if (!remote.Ok)
        {
            await SendJson(context.Response, 200, new { ok = false, message = remote.Output });
            return;
        }

        var pull = await RunGit(root, "pull", "--ff-only", "origin", "main");
        await SendJson(context.Response, 200, new
        {
            ok = pull.Ok,
            message = pull.Ok ? "Mise a jour appliquee. Relance le logiciel si l'interface ne change pas." : "Mise a jour impossible.",
            output = pull.Output
        });
        return;
    }

    await SendJson(context.Response, 404, new { ok = false, message = "API inconnue." });
}

static async Task ServeFile(HttpListenerContext context, string root, string path)
{
    var relative = Uri.UnescapeDataString(path.TrimStart('/'));
    if (string.IsNullOrWhiteSpace(relative))
    {
        relative = "index.html";
    }

    var fullPath = Path.GetFullPath(Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar)));
    if (!fullPath.StartsWith(root, StringComparison.OrdinalIgnoreCase) || !File.Exists(fullPath))
    {
        if (!await ServeEmbedded(context, relative))
        {
            context.Response.StatusCode = 404;
            await using var notFound = new StreamWriter(context.Response.OutputStream);
            await notFound.WriteAsync("Not found");
        }
        return;
    }

    context.Response.ContentType = ContentType(Path.GetExtension(fullPath));
    await using var file = File.OpenRead(fullPath);
    context.Response.ContentLength64 = file.Length;
    await file.CopyToAsync(context.Response.OutputStream);
}

static async Task<bool> ServeEmbedded(HttpListenerContext context, string relative)
{
    var fileName = Path.GetFileName(relative);
    var assembly = Assembly.GetExecutingAssembly();
    var resourceName = assembly.GetManifestResourceNames()
        .FirstOrDefault(name => name.EndsWith($".{fileName}", StringComparison.OrdinalIgnoreCase));

    if (resourceName is null)
    {
        return false;
    }

    await using var stream = assembly.GetManifestResourceStream(resourceName);
    if (stream is null)
    {
        return false;
    }

    context.Response.ContentType = ContentType(Path.GetExtension(fileName));
    context.Response.ContentLength64 = stream.Length;
    await stream.CopyToAsync(context.Response.OutputStream);
    return true;
}

static string ContentType(string extension) => extension.ToLowerInvariant() switch
{
    ".html" => "text/html; charset=utf-8",
    ".css" => "text/css; charset=utf-8",
    ".js" => "text/javascript; charset=utf-8",
    ".json" => "application/json; charset=utf-8",
    ".png" => "image/png",
    ".jpg" or ".jpeg" => "image/jpeg",
    ".webp" => "image/webp",
    ".svg" => "image/svg+xml",
    _ => "application/octet-stream"
};

static void AddSecurityHeaders(HttpListenerResponse response)
{
    response.Headers["X-Content-Type-Options"] = "nosniff";
    response.Headers["X-Frame-Options"] = "DENY";
    response.Headers["Referrer-Policy"] = "no-referrer";
    response.Headers["Cache-Control"] = "no-store";
    response.Headers["Cross-Origin-Resource-Policy"] = "same-origin";
    response.Headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; worker-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
}

static bool IsAllowedMethod(HttpListenerRequest request)
{
    return request.HttpMethod is "GET" or "HEAD" or "POST";
}

static bool IsTrustedRequest(HttpListenerRequest request, int port)
{
    var allowedHosts = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        $"127.0.0.1:{port}",
        $"localhost:{port}",
        $"[::1]:{port}"
    };

    if (!allowedHosts.Contains(request.UserHostName) && request.Headers["Host"] is { } host && !allowedHosts.Contains(host))
    {
        return false;
    }

    if (!IsTrustedUrl(request.Headers["Origin"], allowedHosts)) return false;
    if (!IsTrustedUrl(request.Headers["Referer"], allowedHosts)) return false;

    return true;
}

static bool IsTrustedUrl(string? value, HashSet<string> allowedHosts)
{
    if (string.IsNullOrWhiteSpace(value)) return true;
    return Uri.TryCreate(value, UriKind.Absolute, out var uri) && allowedHosts.Contains(uri.Authority);
}

static bool HasValidToken(HttpListenerRequest request, string sessionToken)
{
    var provided = request.Headers["X-Astro-Token"];
    if (string.IsNullOrWhiteSpace(provided) || provided.Length != sessionToken.Length)
    {
        return false;
    }

    return CryptographicOperations.FixedTimeEquals(
        System.Text.Encoding.UTF8.GetBytes(provided),
        System.Text.Encoding.UTF8.GetBytes(sessionToken)
    );
}

static async Task SendJson(HttpListenerResponse response, int status, object payload)
{
    response.StatusCode = status;
    response.ContentType = "application/json; charset=utf-8";
    await JsonSerializer.SerializeAsync(response.OutputStream, payload);
}

static async Task<(bool Ok, string Output)> RunGit(string root, params string[] args)
{
    try
    {
        var info = new ProcessStartInfo("git")
        {
            WorkingDirectory = root,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        foreach (var arg in args)
        {
            info.ArgumentList.Add(arg);
        }

        using var process = Process.Start(info);
        if (process is null)
        {
            return (false, "Git introuvable.");
        }

        var output = await process.StandardOutput.ReadToEndAsync();
        var error = await process.StandardError.ReadToEndAsync();
        await process.WaitForExitAsync();
        return (process.ExitCode == 0, string.IsNullOrWhiteSpace(output) ? error.Trim() : output.Trim());
    }
    catch (Exception error)
    {
        return (false, error.Message);
    }
}

static async Task<(bool Ok, string Output)> GetTrustedRemote(string root)
{
    var remote = await RunGit(root, "remote", "get-url", "origin");
    if (!remote.Ok)
    {
        return (false, "Aucun depot GitHub n'est configure.");
    }

    if (!Regex.IsMatch(remote.Output, @"github\.com[/:]bouyous/astro-pano-studio(\.git)?$", RegexOptions.IgnoreCase))
    {
        return (false, "Depot distant non autorise pour les mises a jour.");
    }

    return remote;
}

static void OpenBrowser(string url)
{
    try
    {
        Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
    }
    catch
    {
        Console.WriteLine($"Ouvre manuellement: {url}");
    }
}
