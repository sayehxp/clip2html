# Opens every sample in a real mshta window (the IE11 engine clip2hta runs on), records any
# script error and how much was rendered, and closes the window again. tests/run.js cannot catch
# IE-only failures, such as IE rejecting dir="auto", which stopped the page after one line.
#
#   powershell -ExecutionPolicy Bypass -File tests\hta-check.ps1
#
# A window shows for a moment per sample. This file stays ASCII (Windows PowerShell 5.1).
$root = Split-Path $PSScriptRoot -Parent
$utf8 = New-Object System.Text.UTF8Encoding $false
$work = Join-Path $env:TEMP "clip2html-tests"
New-Item -ItemType Directory -Force -Path $work | Out-Null
$log = Join-Path $work "hta.log"
$jsLog = $log.Replace("\", "\\")

$template = [IO.File]::ReadAllText((Join-Path $root "clip2hta.template.hta"), $utf8)
$fix = [IO.File]::ReadAllText((Join-Path $root "clip2html.fix.js"), $utf8)

# Appends one line to the log; window.onerror catches errors, the last script reports and closes
$write = 'var fso=new ActiveXObject("Scripting.FileSystemObject");var f=fso.OpenTextFile("' + $jsLog + '",8,true);f.WriteLine(LINE);f.Close();'
$onError = '<script>window.onerror=function(m,u,l){' + $write.Replace('LINE', '"ERROR "+m+" (line "+l+")"') + 'return true;};</script>'
$report = '<script>(function(){var o=document.getElementById("out");' +
          $write.Replace('LINE', '"ok "+o.children.length+" blocks, "+o.getElementsByTagName("table").length+" tables, IE mode "+document.documentMode') +
          'window.close();})();</script></body>'

$failed = 0
foreach ($sample in Get-ChildItem (Join-Path $PSScriptRoot "samples")) {
  $mode = if ($sample.Extension -eq ".md") { "markdown" } else { "clip" }
  $text = [IO.File]::ReadAllText($sample.FullName, $utf8)
  $page = $template.Replace("{{SCRIPT}}", $fix).Replace("{{STAMP}}", "test").Replace("{{MODE}}", $mode).
                    Replace("{{ASK}}", "").Replace("{{TURNS}}", "").Replace("{{SESSIONS}}", "").Replace("{{SESSION}}", "").
                    Replace("{{RAW}}", [System.Net.WebUtility]::HtmlEncode($text))
  $page = $page.Replace("<hta:application", $onError + "<hta:application").Replace("</body>", $report)
  $file = Join-Path $work ($sample.BaseName + ".hta")
  [IO.File]::WriteAllText($file, $page, (New-Object System.Text.UTF8Encoding $true))

  Remove-Item $log -ErrorAction SilentlyContinue
  $p = Start-Process "$env:SystemRoot\System32\mshta.exe" -ArgumentList ('"' + $file + '"') -PassThru
  if (-not $p.WaitForExit(20000)) { Stop-Process $p -Force }
  $result = if (Test-Path $log) { (Get-Content $log) -join " / " } else { "no report (the window did not finish)" }
  if ($result -notmatch '^ok ' -or $result -match 'ERROR') { $failed++; Write-Host ("FAIL " + $sample.Name + "  " + $result) }
  else { Write-Host ("ok   " + $sample.Name + "  (" + $result.Substring(3) + ")") }
}
if ($failed) { exit 1 }
