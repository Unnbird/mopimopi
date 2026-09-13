<#
.SYNOPSIS
    Generates js/gcd/action-categories-data.js from FFXIV_ACT_Plugin's ActionCategoryList.

.DESCRIPTION
    mopimopi tells a GCD (weaponskill or spell) from an oGCD (ability) by FFXIV's own action
    category, which FFXIV_ACT_Plugin.Resource embeds as "<action id in hex>|<category>". The ACT
    addon used to read that table out of the running process; a web page cannot, so this script
    writes a snapshot of it: one character per action id, index = id, base-36 digit = category.

        1 auto-attack   2 spell (GCD)   3 weaponskill (GCD)   4 ability (oGCD)   9 / 15 limit break

    Accepts either the distributed FFXIV_ACT_Plugin.dll (the Resource assembly is Costura-compressed
    inside it) or an unpacked FFXIV_ACT_Plugin.Resource.dll. With no argument it looks in the ACT
    plugin folder under %APPDATA%, then in the workspace beside this repository.

    Re-run after every game patch: actions the snapshot has never heard of only count as GCDs
    when they show a cast bar (see js/gcd/meter.js).

.EXAMPLE
    .\tools\Build-ActionCategories.ps1
    .\tools\Build-ActionCategories.ps1 "$env:APPDATA\Advanced Combat Tracker\Plugins\FFXIV_ACT_Plugin.dll"
#>
param(
    [string]$PluginPath,
    [string]$OutFile
)
$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
if (-not $OutFile) { $OutFile = Join-Path $repo "js\gcd\action-categories-data.js" }

function Find-Plugin {
    $candidates = @()
    if ($env:APPDATA) {
        $candidates += Join-Path $env:APPDATA "Advanced Combat Tracker\Plugins\FFXIV_ACT_Plugin.dll"
    }
    $workspace = Split-Path -Parent $repo
    $candidates += Join-Path $workspace "OverlayPlugin\Thirdparty\FFXIV_ACT_Plugin\SDK\FFXIV_ACT_Plugin.Resource.dll"
    $candidates += Join-Path $workspace "FF14ACT\FFXIV_ACT_Plugin.dll"
    $candidates += Join-Path $workspace "FF14ACT\FFXIV_ACT_Plugin\bin\Release\FFXIV_ACT_Plugin.Resource.dll"
    foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
    throw ("FFXIV_ACT_Plugin.dll not found; pass its path as the first argument. Looked in:`n  " + ($candidates -join "`n  "))
}

if (-not $PluginPath) { $PluginPath = Find-Plugin }
$PluginPath = (Resolve-Path $PluginPath).Path
"==> reading $PluginPath"

$asm = [Reflection.Assembly]::Load([IO.File]::ReadAllBytes($PluginPath))
$names = $asm.GetManifestResourceNames()

# The distributed plugin embeds its satellite assemblies with Costura: deflate-compressed under
# "costura.<name>.dll.compressed", or plain under "costura.<name>.dll" when compression is off.
$compressed = $names | Where-Object { $_ -ieq "costura.ffxiv_act_plugin.resource.dll.compressed" } | Select-Object -First 1
$plain      = $names | Where-Object { $_ -ieq "costura.ffxiv_act_plugin.resource.dll" } | Select-Object -First 1
if ($compressed -or $plain) {
    $buffer = New-Object IO.MemoryStream
    if ($compressed) {
        $stream = $asm.GetManifestResourceStream($compressed)
        $deflate = New-Object IO.Compression.DeflateStream($stream, [IO.Compression.CompressionMode]::Decompress)
        $deflate.CopyTo($buffer)
        $deflate.Dispose()
        $stream.Dispose()
    } else {
        $stream = $asm.GetManifestResourceStream($plain)
        $stream.CopyTo($buffer)
        $stream.Dispose()
    }
    $asm = [Reflection.Assembly]::Load($buffer.ToArray())
    $names = $asm.GetManifestResourceNames()
    "    unpacked $($asm.GetName().Name) $($asm.GetName().Version) from Costura"
}

# Tolerant about the exact name: it has carried a "Generated." segment and a language suffix for
# a while, and a rename should not stop the build.
$resourceName = $names | Where-Object { $_ -match "ActionCategoryList" } | Select-Object -First 1
if (-not $resourceName) {
    throw "no ActionCategoryList resource in $($asm.GetName().Name); is this FFXIV_ACT_Plugin.dll or FFXIV_ACT_Plugin.Resource.dll?"
}

$reader = New-Object IO.StreamReader($asm.GetManifestResourceStream($resourceName))
$text = $reader.ReadToEnd()
$reader.Dispose()

$digits = "0123456789abcdefghijklmnopqrstuvwxyz"
$rows = @{}
$maxId = 0
$entries = 0
foreach ($line in ($text -split "`r?`n")) {
    $bar = $line.IndexOf('|')
    if ($bar -le 0 -or $bar -eq $line.Length - 1) { continue }
    $id = [Convert]::ToInt32($line.Substring(0, $bar), 16)
    $cat = [int]$line.Substring($bar + 1)
    if ($cat -lt 0 -or $cat -ge $digits.Length) { throw "category $cat at action $id does not fit one base-36 digit" }
    $rows[$id] = $cat
    if ($id -gt $maxId) { $maxId = $id }
    $entries++
}
if ($entries -eq 0) { throw "ActionCategoryList parsed but held no rows" }

$chars = New-Object char[] ($maxId + 1)
for ($i = 0; $i -le $maxId; $i++) { $chars[$i] = '0' }
$gcds = 0
$spells = 0
foreach ($kv in $rows.GetEnumerator()) {
    $chars[$kv.Key] = $digits[$kv.Value]
    if ($kv.Value -eq 2) { $spells++; $gcds++ }
    elseif ($kv.Value -eq 3) { $gcds++ }
}
$table = New-Object string (,$chars)

$version = $asm.GetName().Version.ToString()
$today = (Get-Date).ToString("yyyy-MM-dd")
$js = @"
/*
 * FFXIV action categories, one character per action id: index = id, base-36 digit = category.
 *   1 auto-attack   2 spell (GCD)   3 weaponskill (GCD)   4 ability (oGCD)   0 none
 * Read through js/gcd/categories.js. Ids past the end of the string were added after this
 * snapshot was taken.
 *
 * Generated by tools/Build-ActionCategories.ps1 - do not hand-edit, re-run the script instead.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GcdActionCategoryData = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  return {
    source: 'FFXIV_ACT_Plugin.Resource $version (ActionCategoryList)',
    generatedAt: '$today',
    entries: $entries,
    table: '$table'
  };
});
"@

$outDir = Split-Path -Parent $OutFile
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Force $outDir | Out-Null }
[IO.File]::WriteAllText($OutFile, $js, (New-Object Text.UTF8Encoding($false)))

"==> $entries actions (ids up to $maxId): $gcds GCDs, of which $spells spells"
"    $OutFile ($([Math]::Round((Get-Item $OutFile).Length / 1024)) KB)"
