$ErrorActionPreference = "Stop"

$project = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $project

if (!(Test-Path ".git")) {
  throw "Ce dossier n'est pas un depot Git. Reinstalle depuis GitHub ou configure le depot."
}

git fetch origin main
git pull --ff-only origin main

Write-Host "Mise a jour terminee."
