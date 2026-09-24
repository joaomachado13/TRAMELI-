param(
  [Parameter(Mandatory = $true)][string]$Destination,
  [Parameter(Mandatory = $true)][string]$AgeRecipient
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not [System.IO.Path]::IsPathRooted($Destination)) {
  throw 'Destination deve ser um caminho absoluto fora do repositório.'
}
if ($AgeRecipient -notmatch '^age1[0-9a-z]{20,}$') {
  throw 'AgeRecipient deve ser uma chave pública age (age1...). Nunca informe a chave privada.'
}

$destinationPath = [System.IO.Path]::GetFullPath($Destination).TrimEnd('\', '/')
$projectPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\', '/')
if (-not (Get-Location).Path.TrimEnd('\', '/').Equals($projectPath, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Execute o script na raiz do projeto trameli-dashboard.'
}
$linkedProjectFile = Join-Path $projectPath 'supabase/.temp/project-ref'
if (-not (Test-Path -LiteralPath $linkedProjectFile) -or
  (Get-Content -LiteralPath $linkedProjectFile -Raw).Trim() -ne 'rwxwcyerhqcprarjptak') {
  throw 'A Supabase CLI precisa estar vinculada ao projeto Trameli esperado antes do backup.'
}
if ($destinationPath.Equals([System.IO.Path]::GetPathRoot($destinationPath).TrimEnd('\', '/'), [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Use uma pasta específica; a raiz de uma unidade não é um destino permitido.'
}
$insideProject = $destinationPath.Equals($projectPath, [StringComparison]::OrdinalIgnoreCase) -or
  $destinationPath.StartsWith($projectPath + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
if ($insideProject) {
  throw 'O destino do backup não pode estar dentro do repositório.'
}

foreach ($program in @('supabase', 'age')) {
  if (-not (Get-Command $program -ErrorAction SilentlyContinue)) {
    throw "Instale '$program' antes de executar o backup."
  }
}

New-Item -ItemType Directory -Path $destinationPath -Force | Out-Null
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$runId = [guid]::NewGuid().ToString('N').Substring(0, 8)
$stagingPath = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\', '/')
if ($stagingPath.Equals($destinationPath, [StringComparison]::OrdinalIgnoreCase) -or
  $stagingPath.StartsWith($destinationPath + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'A pasta temporária não pode estar dentro do destino sincronizado.'
}
$outputs = @()
$parts = @(
  @{ Name = 'roles'; Flags = @('--role-only') },
  @{ Name = 'schema'; Flags = @() },
  @{ Name = 'data'; Flags = @('--data-only', '--use-copy') },
  @{ Name = 'auth-data'; Flags = @('--data-only', '--use-copy', '--schema', 'auth') }
)

foreach ($part in $parts) {
  $base = "trameli-$stamp-$runId-$($part.Name).sql"
  $plain = Join-Path $stagingPath ($base + '.partial')
  $encrypted = Join-Path $destinationPath ($base + '.age')
  try {
    $dumpArgs = @('db', 'dump', '--linked', '--file', $plain) + @($part.Flags)
    & supabase @dumpArgs
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $plain) -or (Get-Item -LiteralPath $plain).Length -eq 0) {
      throw "Falha ao exportar $($part.Name)."
    }
    & age -r $AgeRecipient -o $encrypted $plain
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $encrypted) -or (Get-Item -LiteralPath $encrypted).Length -eq 0) {
      throw "Falha ao criptografar $($part.Name)."
    }
    $outputs += [pscustomobject]@{
      File = [System.IO.Path]::GetFileName($encrypted)
      Sha256 = (Get-FileHash -LiteralPath $encrypted -Algorithm SHA256).Hash.ToLowerInvariant()
    }
  }
  finally {
    if (Test-Path -LiteralPath $plain) {
      Remove-Item -LiteralPath $plain -Force
    }
  }
}

$manifest = Join-Path $destinationPath "trameli-$stamp-$runId-manifest.json"
[pscustomobject]@{ CreatedAtUtc = $stamp; Files = $outputs } |
  ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifest -Encoding utf8
Write-Output "Exportação criptografada concluída: $manifest"
Write-Output 'Copie os arquivos .age e o manifesto para um destino externo com acesso restrito e valide uma restauração de teste.'
