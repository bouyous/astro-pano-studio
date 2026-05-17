using System.Diagnostics;
using System.Net;
using System.Reflection;
using System.Text.Json;

var root = FindAppRoot(AppContext.BaseDirectory);
var port = GetPort();
var prefix = $"http://localhost:{port}/";
using var listener = new HttpListener();
listener.Prefixes.Add(prefix);

try
{
    listener.Start();
}
catch (HttpListenerException)
{
    port += 1;
    prefix = $"http://localhost:{port}/";
    listener.Prefixes.Clear();
    listener.Prefixes.Add(prefix);
    listener.Start();
}

Console.WriteLine($"Astro Pano Studio: {prefix}");
OpenBrowser(prefix);

while (listener.IsListening)
{
    var context = await listener.GetContextAsync();
    _ = Task.Run(() => HandleRequest(context, root));
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

static async Task HandleRequest(HttpListenerContext context, string root)
{
    try
    {
        var path = context.Request.Url?.AbsolutePath ?? "/";
        if (path.StartsWith("/api/", StringComparison.OrdinalIgnoreCase))
        {
            await HandleApi(context, path, root);
            return;
        }

        await ServeFile(context, root, path);
    }
    catch (Exception error)
    {
        await SendJson(context.Response, 500, new { ok = false, message = error.Message });
    }
}

static async Task HandleApi(HttpListenerContext context, string path, string root)
{
    if (path.Equals("/api/update/check", StringComparison.OrdinalIgnoreCase))
    {
        var remote = await RunGit(root, "remote", "get-url", "origin");
        if (!remote.Ok)
        {
            await SendJson(context.Response, 200, new { ok = false, message = "Aucun depot GitHub n'est configure." });
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
