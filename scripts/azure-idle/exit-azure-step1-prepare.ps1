# Step 1 of 3 for fully exiting Azure: starts Postgres, resets its admin
# password (the original was never saved anywhere retrievable), and
# temporarily opens public network access + a firewall rule so Azure Cloud
# Shell can reach it to run pg_dump. This is NOT destructive -- fully
# reversible on its own. Run Step 2 (in Cloud Shell) right after this.

$ErrorActionPreference = "Stop"

$rg = "quantalyze-prod-rg"
$pgName = "quantalyze-postgres"

Write-Host "=== Step 1: preparing Postgres for backup ===" -ForegroundColor Cyan

Write-Host "`nStarting Postgres ($pgName)..."
az postgres flexible-server start --resource-group $rg --name $pgName | Out-Null

Write-Host "Waiting for Postgres to report Ready..."
do {
    Start-Sleep -Seconds 10
    $state = az postgres flexible-server show --resource-group $rg --name $pgName --query "state" -o tsv
    Write-Host "  Postgres state: $state"
} while ($state -ne "Ready")

Write-Host "`nGenerating a new admin password (old one was never saved -- this resets it)..."
$chars = (48..57) + (65..90) + (97..122)
$newPassword = -join ((1..24) | ForEach-Object { [char](Get-Random -InputObject $chars) })
az postgres flexible-server update --resource-group $rg --name $pgName --admin-password $newPassword | Out-Null

Write-Host "`nEnabling public network access (temporary -- server gets deleted in Step 3 anyway)..."
az postgres flexible-server update --resource-group $rg --name $pgName --public-network-access Enabled | Out-Null

Write-Host "Adding a firewall rule to allow Azure services (Cloud Shell) to connect..."
az postgres flexible-server firewall-rule create `
  --resource-group $rg --name $pgName `
  --rule-name AllowAzureServicesTemp `
  --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0 | Out-Null

Write-Host "`n=== Done. Copy these into Cloud Shell (Step 2) now: ===" -ForegroundColor Cyan
Write-Host "Admin user:     quantalyzeadmin"
Write-Host "Admin password: $newPassword"
Write-Host "Host:           quantalyze-postgres.postgres.database.azure.com"
Write-Host "`n(This password only matters for the next few minutes -- the server is being deleted in Step 3.)"
