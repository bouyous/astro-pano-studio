$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$project = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $project

if (!(Test-Path ".git")) {
  throw "Ce dossier n'est pas un depot Git. Reinstalle depuis GitHub ou configure le depot."
}

$remote = git remote get-url origin
if ($remote -notmatch "github\.com[/:]bouyous/astro-pano-studio(\.git)?$") {
  throw "Depot distant non autorise pour les mises a jour: $remote"
}

git fetch origin main
git pull --ff-only origin main

Write-Host "Mise a jour terminee."
