<#
.SYNOPSIS
  Regenerates data/api/*.json with the UBotDocExport commandlet (Windows, UE 5.5).

.DESCRIPTION
  The commandlet lives in the uBotCore plugin (UBotCoreEditor module) and is run through
  UnrealEditor-Cmd on a project that has the uBot plugins enabled (DevHost by default):

    UnrealEditor-Cmd <Project> -run=UBotDocExport -Plugin=<PluginName> -Out=<File> [-MergeZh=<File>] -culture=<en|zh-Hans>
    UnrealEditor-Cmd <Project> -run=UBotDocExport -Nodes=<ListFile>   -Out=<File> [-MergeZh=<File>] -culture=<en|zh-Hans>

  Text follows the process culture (UE's own -culture switch), so every file takes two runs: one with
  -culture=zh-Hans into a work file, then one with -culture=en and -MergeZh=<that file>, which adds the
  optional titleZh / subtitleZh / nameZh / displayNameZh fields wherever the Chinese text differs.

  - Each plugin is written to <PluginsDir>\<repo>\docs\api.json (committed to the plugin repository).
  - The curated engine node list data\engine-nodes.txt is written to data\api\engine.json.
  - Finally scripts\sync-api.mjs copies the plugin files into data\api\.

  The commandlet exits with 1 on any error (unknown plugin, an entry of the node list that does not
  resolve, a -MergeZh file of another plugin, ...); this script stops at the first failure and prints
  the commandlet's errors. Full logs stay in the work folder when a run fails.

  Cloud sessions cannot run this (no Unreal Engine there); run it locally after changing a plugin's
  reflected API or data\engine-nodes.txt, then commit data\api\*.json. The editor does not have to be
  closed (nothing is saved besides -Out), but the UBotCoreEditor module must be built.

.EXAMPLE
  powershell -File scripts\export-api.ps1
  powershell -File scripts\export-api.ps1 -Plugins UBotSensor -SkipEngine
  powershell -File scripts\export-api.ps1 -Plugins @() -SkipSync      # engine.json only
#>
[CmdletBinding()]
param(
    [string]$EnginePath = 'D:\Program Files\Epic Games\UE_5.5',
    [string]$Project = 'E:\IDEProjects\UE-EAI-Simulator\DevHost\UBotDev.uproject',
    [string]$PluginsDir = 'E:\IDEProjects\UE-EAI-Simulator\Plugins\uBot',
    [string[]]$Plugins = @('UBotCore', 'UBotSensor', 'UBotROS'),
    # Folder for the zh-Hans work files and the commandlet logs (default: a new folder in %TEMP%).
    [string]$WorkDir = '',
    [switch]$SkipEngine,
    [switch]$SkipSync
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$editorCmd = Join-Path $EnginePath 'Engine\Binaries\Win64\UnrealEditor-Cmd.exe'
$folders = @{ UBotCore = 'uBotCore'; UBotSensor = 'uBotSensor'; UBotROS = 'uBotROS' }

if (-not (Test-Path $editorCmd)) { throw "UnrealEditor-Cmd.exe not found: $editorCmd (use -EnginePath)" }
if (-not (Test-Path $Project)) { throw "Project not found: $Project (use -Project)" }

$ownWorkDir = -not $WorkDir
if ($ownWorkDir) { $WorkDir = Join-Path ([System.IO.Path]::GetTempPath()) ("ubot-docexport-" + [guid]::NewGuid().ToString('N')) }
New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
$failed = $false

function Invoke-Exporter([string]$Name, [string[]]$ExportArgs, [string]$Culture) {
    $log = Join-Path $WorkDir "$Name.$Culture.log"
    $all = @($Project, '-run=UBotDocExport') + $ExportArgs + @("-culture=$Culture", '-unattended', '-nop4', '-nosplash', '-NullRHI', "-abslog=$log")
    Write-Host "> UnrealEditor-Cmd -run=UBotDocExport $($ExportArgs -join ' ') -culture=$Culture"
    # The full engine log goes to $log; only the exporter's own lines are shown.
    & $editorCmd @all | Out-Null
    $code = $LASTEXITCODE
    if (Test-Path $log) {
        Select-String -Path $log -Pattern 'LogUBot: (Display|Error|Warning):' | ForEach-Object { Write-Host ('    ' + ($_.Line -replace '^\[[^\]]*\]\[[^\]]*\]', '')) }
    }
    if ($code -ne 0) {
        $script:failed = $true
        throw "UBotDocExport failed with exit code $code (log: $log)"
    }
}

try {
    foreach ($plugin in $Plugins) {
        $folder = $folders[$plugin]
        if (-not $folder) { throw "Unknown plugin $plugin (known: $($folders.Keys -join ', '))" }
        $pluginRoot = Join-Path $PluginsDir $folder
        if (-not (Test-Path $pluginRoot)) { throw "Plugin folder not found: $pluginRoot (use -PluginsDir)" }
        $docsDir = Join-Path $pluginRoot 'docs'
        New-Item -ItemType Directory -Force -Path $docsDir | Out-Null
        $zhFile = Join-Path $WorkDir "$plugin.zh-Hans.json"
        $outFile = Join-Path $docsDir 'api.json'
        Invoke-Exporter $plugin @("-Plugin=$plugin", "-Out=$zhFile") 'zh-Hans'
        Invoke-Exporter $plugin @("-Plugin=$plugin", "-Out=$outFile", "-MergeZh=$zhFile") 'en'
    }

    if (-not $SkipEngine) {
        $list = Join-Path $repoRoot 'data\engine-nodes.txt'
        $zhFile = Join-Path $WorkDir 'Engine.zh-Hans.json'
        $engineOut = Join-Path $repoRoot 'data\api\engine.json'
        Invoke-Exporter 'Engine' @("-Nodes=$list", "-Out=$zhFile") 'zh-Hans'
        Invoke-Exporter 'Engine' @("-Nodes=$list", "-Out=$engineOut", "-MergeZh=$zhFile") 'en'
    }

    if (-not $SkipSync -and $Plugins.Count -gt 0) {
        & node (Join-Path $repoRoot 'scripts\sync-api.mjs') --from $PluginsDir --strict
        if ($LASTEXITCODE -ne 0) { throw "sync-api failed" }
    }
}
finally {
    # Keep the logs of a failed run for inspection; a folder passed with -WorkDir is never removed.
    if ($ownWorkDir -and -not $failed) { Remove-Item -Recurse -Force $WorkDir -ErrorAction SilentlyContinue }
}

Write-Host 'Done. Next: npm run check; npm run build; commit data/api/*.json (and each plugin''s docs/api.json in its own repository).'
