# clip2html: shows Claude Code's latest reply in a page and opens it, read from the conversation
# Claude Code keeps on disk: exact, in order, nothing to copy. With -Hta (what clip2hta runs) the
# page is an HTML Application opened by mshta instead of the browser.
#
#   clip2html --clip    shows the text on the clipboard instead, repairing Arabic copied from
#                       terminals like Claude Code, which comes out reversed
#   clip2html --last    the default, kept so older habits still work
#
#   clip2html.template.html / clip2hta.template.hta   the page around the text
#   clip2html.fix.js                                  repairing and showing it, shared by both
#
# This file stays ASCII: Windows PowerShell 5.1 reads a .ps1 without BOM in the ANSI code page.
# PowerShell reads --clip and -clip as the -Clip switch; plain "clip" lands in $Mode
param([switch]$Hta, [switch]$Clip, [switch]$Last, [string]$Mode)

$utf8 = New-Object System.Text.UTF8Encoding $false

# Claude Code writes each conversation to ~/.claude/projects/<project>/<session>.jsonl, one JSON
# object per line, and the session in use is the file written last. Its reply is every piece of
# text from "assistant" entries after the user's last real prompt; tool calls and reasoning are
# other kinds of content and are left out. "user" entries that are not something the user typed
# (! commands and their output, tool results, the interrupted notice) do not end the reply.
# Returns the last $Count turns, oldest first, each the prompt (ask) and its reply; a prompt with
# no text after it yet is skipped, and a reply whose prompt is not in the record has an empty ask.
# A session with no reply yet (just started, or just after /clear, which starts a new file) gives
# way to the one written before it.
#
# The page's session dropdown lists the $Keep newest sessions with a reply. Each is kept in
# %TEMP%\clip2html\sessions\<id>.js (window.clipSession = {id, name, turns}), which the page loads
# when one is picked, and sessions\index.json remembers each one's name and when it was read, so a
# session is read again only when it changed: usually only the one in use.
# Returns @{ turns; name; id; list } for the newest session with a reply.
function Get-Turns($Count = 30, $Keep = 15) {
    $projects = Join-Path $env:USERPROFILE ".claude\projects"
    $files = Get-ChildItem -Path $projects -Filter *.jsonl -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.Directory.Parent.FullName -eq (Get-Item $projects).FullName } |
        Sort-Object LastWriteTime -Descending | Select-Object -First 60

    $cache = Join-Path $env:TEMP "clip2html\sessions"
    New-Item -ItemType Directory -Force -Path $cache | Out-Null
    $indexFile = Join-Path $cache "index.json"
    $index = @{}
    if (Test-Path $indexFile) {
        try { foreach ($e in ([IO.File]::ReadAllText($indexFile, $utf8) | ConvertFrom-Json)) { $index[$e.id] = $e } } catch { }
    }

    $found = @{ turns = @(); name = ""; id = ""; list = @() }
    $list = New-Object System.Collections.ArrayList
    $seen = New-Object System.Collections.ArrayList
    foreach ($f in $files) {
        if ($list.Count -ge $Keep) { break }
        $id = $f.BaseName
        $stamp = [string]$f.LastWriteTimeUtc.Ticks
        $e = $index[$id]
        $js = Join-Path $cache "$id.js"
        # the session shown is always read again; the others only when changed
        if (-not $found.id -or -not $e -or $e.stamp -ne $stamp -or ($e.count -and -not (Test-Path $js))) {
            $turns = Get-SessionTurns $f.FullName $Count
            $project = if ($script:sessionCwd) { Split-Path $script:sessionCwd -Leaf } else { "" }
            $e = [pscustomobject]@{ id = $id; stamp = $stamp; name = $script:sessionTitle; project = $project
                                    time = $f.LastWriteTime.ToString("yyyy-MM-dd HH:mm"); count = $turns.Count }
            $index[$id] = $e
            if ($turns.Count) {
                [IO.File]::WriteAllText($js, "window.clipSession = " +
                    (ConvertTo-AsciiJson ([ordered]@{ id = $id; name = $e.name; turns = $turns })) + ";", $utf8)
                if (-not $found.id) { $found = @{ turns = $turns; name = $e.name; id = $id } }
            }
        }
        [void]$seen.Add($e)
        if ($e.count) { [void]$list.Add($e) }
    }

    # forget sessions that dropped off the list; the index also keeps the ones with no reply, so
    # they are not read again either
    $keepIds = @{}
    foreach ($e in $list) { $keepIds[$e.id] = $true }
    Get-ChildItem -Path $cache -Filter *.js | Where-Object { -not $keepIds[$_.BaseName] } | Remove-Item -ErrorAction SilentlyContinue
    [IO.File]::WriteAllText($indexFile, (ConvertTo-Json -InputObject $seen.ToArray() -Depth 3 -Compress), $utf8)

    $found.list = @($list | ForEach-Object { [ordered]@{ id = $_.id; name = $_.name; project = $_.project; time = $_.time } })
    return $found
}

# JSON with every non-ASCII character written as \uXXXX, so a script file reads the same in any
# encoding the page assumes for it
function ConvertTo-AsciiJson($value) {
    $json = ConvertTo-Json -InputObject $value -Depth 4 -Compress
    [regex]::Replace($json, '[^\x00-\x7f]', { param($m) '\u{0:x4}' -f [int][char]$m.Value })
}

# Also sets $script:sessionTitle to the session's name: the one given with /rename (a
# "custom-title" entry) or else the one Claude Code made up ("ai-title"), "" when neither is there;
# and $script:sessionCwd to the folder it ran in.
function Get-SessionTurns($path, $Count) {
    # Conversations grow to many megabytes; the last turns are near the end, so read the tail
    # first and the whole file only when the tail does not hold one whole turn
    foreach ($tail in 4MB, 0) {
        $stream = [System.IO.File]::Open($path, 'Open', 'Read', 'ReadWrite')
        try {
            if ($tail -gt 0 -and $stream.Length -gt $tail) { $stream.Seek(-$tail, 'End') | Out-Null }
            $reader = New-Object System.IO.StreamReader($stream, $utf8)
            $lines = $reader.ReadToEnd() -split "`n"
        } finally { $stream.Dispose() }

        $script:sessionCwd = ""
        $at = @($lines | Where-Object { $_ -like '*"cwd":"*' }) | Select-Object -Last 1
        if ($at -match '"cwd":"((?:[^"\\]|\\.)*)"') { $script:sessionCwd = $matches[1] -replace '\\\\', '\' }

        $script:sessionTitle = ""
        foreach ($kind in 'custom-title|customTitle', 'ai-title|aiTitle') {
            $type, $key = $kind -split '\|'
            $named = @($lines | Where-Object { $_ -like "*`"type`":`"$type`"*" }) | Select-Object -Last 1
            if ($named) {
                try { $script:sessionTitle = [string](($named | ConvertFrom-Json).$key) } catch { }
                if ($script:sessionTitle.Trim()) { break }
            }
        }

        $turns = New-Object System.Collections.ArrayList
        $parts = New-Object System.Collections.ArrayList
        for ($i = $lines.Length - 1; $i -ge 0; $i--) {
            $line = $lines[$i]
            if ($line -notmatch '"type":"(assistant|user)"') { continue }
            try { $entry = $line | ConvertFrom-Json } catch { continue }
            # other kinds of entry (api-request-blob...) carry copies of the prompt; only the
            # conversation's own user and assistant entries count
            if ($entry.type -ne 'assistant' -and $entry.type -ne 'user') { continue }
            if ($entry.isSidechain -or $entry.isMeta) { continue }
            $content = $entry.message.content

            if ($entry.type -eq 'assistant') {
                $texts = @($content | Where-Object { $_.type -eq 'text' } | ForEach-Object { $_.text })
                [array]::Reverse($texts)
                foreach ($t in $texts) { if ($t.Trim()) { [void]$parts.Add($t) } }
                continue
            }

            $typed = $null
            if ($content -is [string]) { $typed = $content }
            else {
                $typed = (@($content | Where-Object { $_.type -eq 'text' } | ForEach-Object { $_.text }) -join "`n")
                if (@($content | Where-Object { $_.type -eq 'tool_result' }).Count) { $typed = $null }
            }
            $isPrompt = $typed -and $typed.Trim() -and
                $typed -notmatch '^\s*<(bash-input|bash-stdout|bash-stderr|command-name|command-message|local-command|system-reminder|task-notification)' -and
                $typed -notmatch '^\[Request interrupted'
            if ($isPrompt -and $parts.Count) {
                $parts.Reverse()
                # pasted text comes wrapped in a <pasted_content id="..."> tag; the text is what counts
                $asked = ($typed -replace '</?pasted_content[^>]*>', '').Trim()
                [void]$turns.Add([ordered]@{ ask = $asked; reply = ($parts -join "`n`n") })
                $parts.Clear()
                if ($turns.Count -ge $Count) { break }
            }
        }
        if ($tail -eq 0 -and -not $turns.Count -and $parts.Count) {
            $parts.Reverse()
            [void]$turns.Add([ordered]@{ ask = ""; reply = ($parts -join "`n`n") })
        }
        if ($turns.Count) { $turns.Reverse(); return ,$turns.ToArray() }
    }
    return ,@()
}

if ($args.Count -and -not $Mode) { $Mode = $args[0] }
$turnsJson = ""
$sessionTitle = ""
$sessionsJson = ""
if ($Mode -eq 'last') { $Mode = $null }
if ($Mode -eq 'clip') { $Clip = $true; $Mode = $null }
if ($Mode) {
    Write-Host "clip2html: unknown option '$Mode'. Use no option for Claude Code's latest reply, or --clip for the clipboard"
    exit 1
} elseif (-not $Clip) {
    $found = Get-Turns
    $turns = $found.turns
    $text = $null
    $ask = ""
    if ($turns.Count) {
        $text = $turns[-1].reply
        $ask = $turns[-1].ask
        $turnsJson = ConvertTo-Json -InputObject $turns -Depth 3 -Compress
        $sessionTitle = $found.name
        # the dropdown's sessions, newest first, and which one this page shows
        $sessionsJson = ConvertTo-Json -InputObject ([ordered]@{ at = $found.id; list = @($found.list) }) -Depth 4 -Compress
    }
    $kind = "markdown"
    if ([string]::IsNullOrEmpty($text)) {
        Write-Host "clip2html: no Claude Code reply found in $env:USERPROFILE\.claude\projects"
        exit 1
    }
} else {
    $text = Get-Clipboard -Raw
    $ask = ""
    $kind = "clip"
    if ([string]::IsNullOrEmpty($text)) {
        Write-Host "clip2html: the clipboard has no text, copy something first"
        exit 1
    }
}

$read = { param($name) [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot $name), $utf8) }

if ($Hta) { $template = & $read "clip2hta.template.hta"; $ext = ".hta" }
else      { $template = & $read "clip2html.template.html"; $ext = ".html" }

# The text, the prompt and the earlier turns go in last and HTML-encoded, each sitting in a
# <textarea> as text: <, > and & in them cannot become tags. All go in one pass, so nothing in
# one is mistaken for another's placeholder
$page = $template.Replace("{{SCRIPT}}", (& $read "clip2html.fix.js")).
                  Replace("{{STAMP}}", (Get-Date -Format "yyyy-MM-dd HH:mm:ss")).
                  Replace("{{MODE}}", $kind)
$fill = @{ ASK = $ask; RAW = $text; TURNS = $turnsJson; SESSION = $sessionTitle; SESSIONS = $sessionsJson }
$page = [regex]::Replace($page, '\{\{(ASK|RAW|TURNS|SESSIONS|SESSION)\}\}',
    { param($m) [System.Net.WebUtility]::HtmlEncode([string]$fill[$m.Groups[1].Value]) })

$dir = Join-Path $env:TEMP "clip2html"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$file = Join-Path $dir ("clip-" + (Get-Date -Format "yyyyMMdd-HHmmss") + $ext)

# mshta guesses the encoding from a BOM, so the .hta gets one; browsers follow <meta charset>
$encoding = if ($Hta) { New-Object System.Text.UTF8Encoding $true } else { $utf8 }
[System.IO.File]::WriteAllText($file, $page, $encoding)

if ($Hta) { Start-Process "$env:SystemRoot\System32\mshta.exe" -ArgumentList ('"' + $file + '"') }
else      { Start-Process $file }
Write-Host "clip2html: opened $file"
