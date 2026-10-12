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

  - The plugins come from data\index.json (every released package; -Plugins narrows the list). Each one
    is written to <PluginsDir>\<folder>\docs\api.json (committed to the plugin repository); <folder> is
    the index's "folder", else the repository name.
  - The engine node lists data\engine-nodes\*.txt are merged into one work file (the commandlet takes
    one -Nodes list) and written to data\api\engine.json.
  - Finally scripts\sync-api.mjs copies the plugin files into data\api\.

  Before anything runs, the script checks the project: every plugin to export must be enabled in the
  .uproject (listed with "Enabled": true, or found through AdditionalPluginDirectories and not
  disabled), and every engine plugin the node lists or the packages' "enginePlugins" need must be
  available. It prints exactly what to add when something is missing. -SkipEngine skips only the node
  lists (their modules and content mount points); the packages' "enginePlugins" are always checked.

  The commandlet exits with 1 on any error (unknown plugin, an entry of the node list that does not
  resolve, a -MergeZh file of another plugin, ...); this script stops at the first failure and prints
  the commandlet's errors, with the source file and line of node list entries. Full logs stay in the
  work folder when a run fails.

  Cloud sessions cannot run this (no Unreal Engine there); run it locally after changing a plugin's
  reflected API or data\engine-nodes\*.txt, then commit data\api\*.json. The editor does not have to be
  closed (nothing is saved besides -Out), but the UBotCoreEditor module must be built.

.EXAMPLE
  powershell -File scripts\export-api.ps1
  powershell -File scripts\export-api.ps1 -Plugins UBotSensor -SkipEngine
  powershell -File scripts\export-api.ps1 -Plugins @() -SkipSync      # engine.json only
#>
[CmdletBinding()]
param(
    [string]$EnginePath = 'D:\Program Files\Epic Games\UE_5.5',
    # Defaults: the uBot workspace layout, with DevHost and Plugins\uBot next to this repository.
    [string]$Project = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\DevHost\UBotDev.uproject')),
    [string]$PluginsDir = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\Plugins\uBot')),
    # Default: every released package in data\index.json.
    [string[]]$Plugins,
    # Folder for the zh-Hans work files and the commandlet logs (default: a new folder in %TEMP%).
    [string]$WorkDir = '',
    [switch]$SkipEngine,
    [switch]$SkipSync
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$editorCmd = Join-Path $EnginePath 'Engine\Binaries\Win64\UnrealEditor-Cmd.exe'

if (-not (Test-Path $editorCmd)) { throw "UnrealEditor-Cmd.exe not found: $editorCmd (use -EnginePath)" }
if (-not (Test-Path $Project)) { throw "Project not found: $Project (use -Project)" }

# ---------------------------------------------------------------- packages from data\index.json

function Read-Json([string]$Path) {
    # UTF-8 without BOM: read the bytes, Windows PowerShell would assume the ANSI code page.
    $text = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
    return $text | ConvertFrom-Json
}

function Get-FolderName($Package) {
    if ($Package.folder) { return [string]$Package.folder }
    $url = ([string]$Package.repository) -replace '[?#].*$', '' -replace '/+$', ''
    $last = ($url -split '[/:]')[-1]
    return ($last -replace '\.git$', '')
}

$indexPath = Join-Path $repoRoot 'data\index.json'
if (-not (Test-Path $indexPath)) { throw "data\index.json not found; run: npm run sync-index" }
$index = Read-Json $indexPath
$released = [ordered]@{}
foreach ($pkg in @($index.packages)) {
    $versions = @($pkg.versions | Where-Object { $_ -and -not $_.planned })
    if ($versions.Count -gt 0) {
        $released[[string]$pkg.name] = [pscustomobject]@{
            Name = [string]$pkg.name
            Folder = Get-FolderName $pkg
            EnginePlugins = @($versions | ForEach-Object { @($_.enginePlugins) } | Where-Object { $_ } | Sort-Object -Unique)
        }
    }
}
if (-not $PSBoundParameters.ContainsKey('Plugins')) { $Plugins = @($released.Keys) }
foreach ($plugin in $Plugins) {
    if (-not $released.Contains($plugin)) {
        throw "Unknown or unreleased package $plugin (released in data\index.json: $(@($released.Keys) -join ', '))"
    }
}

# ---------------------------------------------------------------- project checks

$projectDir = Split-Path -Parent $Project
$uproject = Read-Json $Project
$projectPlugins = @{}
foreach ($entry in @($uproject.Plugins)) { if ($entry -and $entry.Name) { $projectPlugins[[string]$entry.Name] = $entry } }
$pluginDirs = @(Join-Path $projectDir 'Plugins')
foreach ($dir in @($uproject.AdditionalPluginDirectories)) {
    if ($dir) { $pluginDirs += [System.IO.Path]::GetFullPath((Join-Path $projectDir $dir)) }
}

function Find-ProjectPlugin([string]$Name) {
    foreach ($dir in $pluginDirs) {
        if (-not (Test-Path $dir)) { continue }
        $hit = Get-ChildItem -Path $dir -Recurse -Depth 3 -Filter "$Name.uplugin" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($hit) { return $hit.FullName }
    }
    return $null
}

$problems = New-Object System.Collections.Generic.List[string]
$enabledProjectPlugins = @()
foreach ($plugin in $Plugins) {
    $folder = $released[$plugin].Folder
    $pluginRoot = Join-Path $PluginsDir $folder
    if (-not (Test-Path (Join-Path $pluginRoot "$plugin.uplugin"))) {
        $problems.Add("$plugin is not checked out at $pluginRoot ($plugin.uplugin missing; use -PluginsDir, or clone its repository there)")
        continue
    }
    $entry = $projectPlugins[$plugin]
    if ($entry -and $entry.Enabled -eq $false) {
        $problems.Add("$plugin is disabled in $Project. Change its entry in ""Plugins"" to: { ""Name"": ""$plugin"", ""Enabled"": true }")
        continue
    }
    if ($entry -and $entry.Enabled -eq $true) { $enabledProjectPlugins += $plugin; continue }
    $found = Find-ProjectPlugin $plugin
    if ($found) {
        $descriptor = Read-Json $found
        if ($descriptor.EnabledByDefault -eq $false) {
            $problems.Add("$plugin is found through AdditionalPluginDirectories but not enabled by default. Add to ""Plugins"" in ${Project}: { ""Name"": ""$plugin"", ""Enabled"": true }")
        }
        else { $enabledProjectPlugins += $plugin }
        continue
    }
    $relative = $PluginsDir
    try { $relative = [System.Uri]::new($projectDir.TrimEnd('\') + '\').MakeRelativeUri([System.Uri]::new($PluginsDir)).ToString() -replace '%20', ' ' } catch { }
    $problems.Add("$plugin is not part of $Project. Add to ""Plugins"": { ""Name"": ""$plugin"", ""Enabled"": true }, and make the folder visible: add ""$relative"" to ""AdditionalPluginDirectories"" (or copy $pluginRoot into $(Join-Path $projectDir 'Plugins'))")
}

# Is <Module> a module of the engine's own source? Most sit in Engine\Source\{Runtime,Editor,Developer}\<Module>,
# but many are nested deeper (Runtime\Experimental\Chaos, ...\FieldSystem\Source\FieldSystemEngine), so the
# fallback finds <Module>.Build.cs anywhere below those three folders (listed once, on first need).
$engineSource = Join-Path $EnginePath 'Engine\Source'
$engineModules = $null
function Test-EngineSourceModule([string]$Module) {
    if (@('Runtime', 'Editor', 'Developer') | Where-Object { Test-Path (Join-Path $engineSource "$_\$Module") }) { return $true }
    if ($null -eq $script:engineModules) {
        $script:engineModules = @{}
        $roots = @('Runtime', 'Editor', 'Developer') | ForEach-Object { Join-Path $engineSource $_ } | Where-Object { Test-Path $_ }
        foreach ($file in Get-ChildItem -Path $roots -Recurse -Filter '*.Build.cs' -ErrorAction SilentlyContinue) {
            $script:engineModules[$file.Name.Substring(0, $file.Name.Length - '.Build.cs'.Length)] = $true
        }
    }
    return $script:engineModules.ContainsKey($Module)
}

# Engine plugins: the ones the exported packages declare in data\index.json ("enginePlugins"), always
# checked, and the ones the node lists need (by script module or content mount point), unless -SkipEngine.
$requiredEngine = [ordered]@{}
foreach ($plugin in $Plugins) {
    foreach ($ep in $released[$plugin].EnginePlugins) { $requiredEngine[[string]$ep] = "$plugin (enginePlugins in data\index.json)" }
}
$unresolved = @()
if (-not $SkipEngine) {
    $needs = (& node (Join-Path $repoRoot 'scripts\engine-nodes.mjs') modules) | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { throw "scripts\engine-nodes.mjs modules failed" }
    foreach ($module in @($needs.modules)) {
        if (-not $module) { continue }
        if (-not (Test-EngineSourceModule $module)) { $unresolved += $module }
    }
    foreach ($mount in @($needs.mounts)) { if ($mount) { $requiredEngine[[string]$mount] = "content /$mount/ in data\engine-nodes" } }
}
if ($unresolved.Count -gt 0 -or $requiredEngine.Count -gt 0) {
    Write-Host '> scanning engine plugins'
    $engineDescriptors = @{}
    $moduleOwner = @{}
    foreach ($file in Get-ChildItem -Path (Join-Path $EnginePath 'Engine\Plugins') -Recurse -Filter *.uplugin -ErrorAction SilentlyContinue) {
        $engineDescriptors[$file.BaseName] = $file.FullName
        try { $d = Read-Json $file.FullName } catch { continue }
        foreach ($m in @($d.Modules)) { if ($m -and $m.Name) { $moduleOwner[[string]$m.Name] = $file.BaseName } }
    }
    foreach ($module in $unresolved) {
        if ($moduleOwner.ContainsKey($module)) { $requiredEngine[$moduleOwner[$module]] = "module $module in data\engine-nodes" }
        else { $problems.Add("data\engine-nodes: module /Script/$module is neither an engine module nor in an engine plugin of $EnginePath") }
    }
    # Plugins that enabled project plugins pull in through their own descriptors.
    $pulledIn = @{}
    foreach ($name in $enabledProjectPlugins) {
        $path = Find-ProjectPlugin $name
        if (-not $path) { $path = Join-Path (Join-Path $PluginsDir $released[$name].Folder) "$name.uplugin" }
        if (Test-Path $path) { foreach ($dep in @((Read-Json $path).Plugins)) { if ($dep -and $dep.Enabled -ne $false) { $pulledIn[[string]$dep.Name] = $name } } }
    }
    foreach ($name in $requiredEngine.Keys) {
        $why = $requiredEngine[$name]
        if (-not $engineDescriptors.ContainsKey($name)) { $problems.Add("engine plugin $name (needed by $why) is not installed in $EnginePath"); continue }
        $entry = $projectPlugins[$name]
        if ($entry -and $entry.Enabled -eq $false) { $problems.Add("engine plugin $name (needed by $why) is disabled in $Project. Change its entry in ""Plugins"" to: { ""Name"": ""$name"", ""Enabled"": true }"); continue }
        if ($entry -and $entry.Enabled -eq $true) { continue }
        if ($pulledIn.ContainsKey($name)) { continue }
        if ((Read-Json $engineDescriptors[$name]).EnabledByDefault -eq $true) { continue }
        $problems.Add("engine plugin $name (needed by $why) is not enabled. Add to ""Plugins"" in ${Project}: { ""Name"": ""$name"", ""Enabled"": true }")
    }
}

if ($problems.Count -gt 0) {
    Write-Host 'The project is not ready for the export:' -ForegroundColor Red
    foreach ($p in $problems) { Write-Host "  - $p" }
    throw "fix the project (above) and run again"
}

# ---------------------------------------------------------------- export

$ownWorkDir = -not $WorkDir
if ($ownWorkDir) { $WorkDir = Join-Path ([System.IO.Path]::GetTempPath()) ("ubot-docexport-" + [guid]::NewGuid().ToString('N')) }
New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
$failed = $false

function Invoke-Exporter([string]$Name, [string[]]$ExportArgs, [string]$Culture, [string]$NodeList = '') {
    $log = Join-Path $WorkDir "$Name.$Culture.log"
    $all = @($Project, '-run=UBotDocExport') + $ExportArgs + @("-culture=$Culture", '-unattended', '-nop4', '-nosplash', '-NullRHI', "-abslog=$log")
    Write-Host "> UnrealEditor-Cmd -run=UBotDocExport $($ExportArgs -join ' ') -culture=$Culture"
    # The full engine log goes to $log; only the exporter's own lines are shown.
    & $editorCmd @all | Out-Null
    $code = $LASTEXITCODE
    if (Test-Path $log) {
        Select-String -Path $log -Pattern 'LogUBot: (Display|Error|Warning):' | ForEach-Object {
            $line = $_.Line -replace '^\[[^\]]*\]\[[^\]]*\]', ''
            # "Line 7: ..." of the merged node list: name the source file and line instead.
            if ($NodeList -and $line -match 'Line (\d+):') {
                $source = (& node (Join-Path $repoRoot 'scripts\engine-nodes.mjs') locate $NodeList $Matches[1])
                $line = "$line  [$source]"
            }
            Write-Host ('    ' + $line)
        }
    }
    if ($code -ne 0) {
        $script:failed = $true
        throw "UBotDocExport failed with exit code $code (log: $log)"
    }
}

try {
    foreach ($plugin in $Plugins) {
        $pluginRoot = Join-Path $PluginsDir $released[$plugin].Folder
        $docsDir = Join-Path $pluginRoot 'docs'
        New-Item -ItemType Directory -Force -Path $docsDir | Out-Null
        $zhFile = Join-Path $WorkDir "$plugin.zh-Hans.json"
        $outFile = Join-Path $docsDir 'api.json'
        Invoke-Exporter $plugin @("-Plugin=$plugin", "-Out=$zhFile") 'zh-Hans'
        Invoke-Exporter $plugin @("-Plugin=$plugin", "-Out=$outFile", "-MergeZh=$zhFile") 'en'
    }

    if (-not $SkipEngine) {
        $list = Join-Path $WorkDir 'engine-nodes.txt'
        & node (Join-Path $repoRoot 'scripts\engine-nodes.mjs') merge $list
        if ($LASTEXITCODE -ne 0) { throw "data\engine-nodes has errors (npm run check)" }
        $zhFile = Join-Path $WorkDir 'Engine.zh-Hans.json'
        $engineOut = Join-Path $repoRoot 'data\api\engine.json'
        Invoke-Exporter 'Engine' @("-Nodes=$list", "-Out=$zhFile") 'zh-Hans' $list
        Invoke-Exporter 'Engine' @("-Nodes=$list", "-Out=$engineOut", "-MergeZh=$zhFile") 'en' $list
    }

    if (-not $SkipSync -and $Plugins.Count -gt 0) {
        $syncArgs = @((Join-Path $repoRoot 'scripts\sync-api.mjs'), '--from', $PluginsDir, '--strict')
        foreach ($plugin in $Plugins) { $syncArgs += @('--package', $plugin) }
        & node @syncArgs
        if ($LASTEXITCODE -ne 0) { throw "sync-api failed" }
    }
}
finally {
    # Keep the logs of a failed run for inspection; a folder passed with -WorkDir is never removed.
    if ($ownWorkDir -and -not $failed) { Remove-Item -Recurse -Force $WorkDir -ErrorAction SilentlyContinue }
}

Write-Host 'Done. Next: npm run check; npm run build; commit data/api/*.json (and each plugin''s docs/api.json in its own repository).'
