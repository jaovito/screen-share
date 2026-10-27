import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { run } from '../../scripts/lib';

// This prerequisite applies only to the disposable Windows CI/test host.
// Edge Stable itself is not a supported WebView2 runtime.
const install = String.raw`param([string]$Directory)
$ErrorActionPreference = 'Stop'
function Read-RuntimeVersion {
  $paths = @(
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'HKCU:\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
  )
  foreach ($path in $paths) {
    $version = (Get-ItemProperty -LiteralPath $path -ErrorAction SilentlyContinue).pv
    if ($version -and $version -ne '0.0.0.0') { return [string]$version }
  }
  return $null
}
$version = Read-RuntimeVersion
if (-not $version) {
  Write-Output 'WebView2 runtime absent; installing verified Microsoft Evergreen bootstrapper.'
  $installer = Join-Path $Directory 'MicrosoftEdgeWebview2Setup.exe'
  Invoke-WebRequest -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $installer -TimeoutSec 60
  $signature = Get-AuthenticodeSignature -LiteralPath $installer
  if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation(?:,|$)') {
    throw 'WebView2 bootstrapper does not have a valid Microsoft publisher signature'
  }
  $setup = Start-Process -FilePath $installer -ArgumentList '/silent', '/install' -PassThru
  if (-not $setup.WaitForExit(120000)) {
    $setup.Kill()
    throw 'WebView2 installation exceeded its bounded deadline'
  }
  if ($setup.ExitCode -ne 0) { throw "WebView2 installation failed with code $($setup.ExitCode)" }
  $version = Read-RuntimeVersion
  if (-not $version) { throw 'WebView2 runtime is unavailable after installation' }
}
Write-Output "WebView2 Evergreen runtime: $version"
`;

export async function ensureWebViewRuntime(directory: string) {
  if (process.platform !== 'win32') throw new Error('WebView2 prerequisite requires Windows');
  const script = join(directory, 'ensure-webview-runtime.ps1');
  await writeFile(script, install, { flag: 'wx' });
  await run(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-File', script, '-Directory', directory],
    { timeout: 200_000 },
  );
}
