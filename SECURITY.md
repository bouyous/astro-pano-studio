# Security

Astro Pano Studio is a local desktop-style application. It starts a local web server and opens the interface in the browser.

## Built-in protections

- The server binds to `127.0.0.1` only.
- Update APIs require a per-session random token.
- Sensitive API requests are checked against the local `Origin`, `Referer`, and `Host`.
- Cross-origin browser access is not enabled.
- Security headers are sent for local pages and API responses.
- File serving is restricted to the application directory or embedded application assets.
- The updater only accepts the official repository: `github.com/bouyous/astro-pano-studio`.
- Git commands are executed with fixed argument lists, not shell-built command strings.

## Update safety

Use the in-app update button or:

```powershell
.\update.ps1
```

The update script refuses unknown Git remotes.

## Limitations

No local application can protect a computer that is already compromised. Keep Windows, Git, and your browser up to date, and download releases only from the official GitHub repository.
