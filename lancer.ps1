$ErrorActionPreference = "Stop"
$project = Split-Path -Parent $MyInvocation.MyCommand.Path
$bundledNode = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

Set-Location $project

try {
  node server.js
} catch {
  if (Test-Path $bundledNode) {
    & $bundledNode server.js
  } else {
    throw
  }
}
