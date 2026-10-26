# Starts the local demo stack: private PostgreSQL (port 5433), API (4000) and web (3000).
# First run: npm install, then run this script (creates cluster, schema, SQL constraints, seed).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$pgBin = 'C:\Program Files\PostgreSQL\16\bin'
$pgData = Join-Path $root '.pgdata'

if (-not (Test-Path $pgData)) {
  & "$pgBin\initdb.exe" -D $pgData -U wnmp -A trust -E UTF8 --locale=C | Out-Null
}

& "$pgBin\pg_isready.exe" -h localhost -p 5433 | Out-Null
if ($LASTEXITCODE -ne 0) {
  Start-Process -WindowStyle Hidden -FilePath "$pgBin\pg_ctl.exe" -ArgumentList '-D', $pgData, '-o', '"-p 5433 -c listen_addresses=localhost"', '-l', "$pgData\server.log", '-w', 'start'
  do { Start-Sleep -Seconds 1; & "$pgBin\pg_isready.exe" -h localhost -p 5433 | Out-Null } while ($LASTEXITCODE -ne 0)
}

& "$pgBin\psql.exe" -w -h localhost -p 5433 -U wnmp -d postgres -tc "select 1 from pg_database where datname='wnmp'" | Select-String 1 | Out-Null
if ($LASTEXITCODE -ne 0) { & "$pgBin\createdb.exe" -w -h localhost -p 5433 -U wnmp wnmp }

Push-Location "$root\apps\api"
npm run build
npm run db:push
npm run db:sql
npm run seed
Pop-Location

Start-Process powershell -ArgumentList '-NoExit', '-Command', "cd '$root\apps\api'; node dist/main.js"
Start-Process powershell -ArgumentList '-NoExit', '-Command', "cd '$root\apps\web'; npm run build; npx next start -p 3000"
Write-Host 'API: http://localhost:4000/api   Web: http://localhost:3000'
