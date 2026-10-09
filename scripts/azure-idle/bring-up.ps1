# Brings the idle-cost resources back up for Quantalyze's Azure backend.
# Run this BEFORE you need to use the app -- allow a couple of minutes for
# everything to settle before logging in.
#
# What it does:
#   1. Recreates the NAT Gateway's static public IP.
#   2. Recreates the NAT Gateway, attached to that new IP.
#   3. Reattaches the NAT Gateway to the subnet(s) recorded by teardown-idle.ps1.
#   4. Starts the Postgres Flexible Server and waits until it reports "Ready".
#
# Note: the new outbound IP will differ from the previous one every time --
# this is expected and confirmed safe (nothing external allow-lists it; see
# teardown-idle.ps1's header comment for why).
#
# Requires: az CLI, already logged in (az login), correct subscription selected,
# and nat-gateway-state.json present (created by teardown-idle.ps1).

$ErrorActionPreference = "Stop"

$rg = "quantalyze-prod-rg"
$vnet = "quantalyze-prod-vnet"
$location = "centralindia"
$natGwName = "quantalyze-nat-gateway"
$natIpName = "quantalyze-nat-gateway-ip"
$pgName = "quantalyze-postgres"
$stateFile = "$PSScriptRoot\nat-gateway-state.json"

Write-Host "=== Quantalyze: bringing up idle-cost resources ===" -ForegroundColor Cyan

if (-not (Test-Path $stateFile)) {
    Write-Error "No state file found at $stateFile. Run teardown-idle.ps1 first, or manually edit this script to hardcode the subnet name(s)."
    exit 1
}
$attachedSubnets = Get-Content $stateFile | ConvertFrom-Json
if (-not $attachedSubnets -or $attachedSubnets.Count -eq 0) {
    Write-Warning "State file has no recorded subnets. NAT Gateway will be created but not attached to anything -- attach manually."
}

Write-Host "`nCreating static IP ($natIpName)..."
az network public-ip create `
  --resource-group $rg --name $natIpName --location $location `
  --sku Standard --allocation-method Static | Out-Null
Write-Host "  Created." -ForegroundColor Green

Write-Host "`nCreating NAT Gateway ($natGwName)..."
az network nat gateway create `
  --resource-group $rg --name $natGwName --location $location `
  --public-ip-addresses $natIpName --idle-timeout 10 | Out-Null
Write-Host "  Created." -ForegroundColor Green

foreach ($subnet in $attachedSubnets) {
    if ([string]::IsNullOrWhiteSpace($subnet)) { continue }
    Write-Host "`nReattaching NAT Gateway to subnet: $subnet"
    az network vnet subnet update `
      --resource-group $rg --vnet-name $vnet --name $subnet `
      --nat-gateway $natGwName | Out-Null
    Write-Host "  Reattached." -ForegroundColor Green
}

Write-Host "`nStarting Postgres ($pgName)..."
az postgres flexible-server start --resource-group $rg --name $pgName | Out-Null

Write-Host "Waiting for Postgres to report Ready..."
do {
    Start-Sleep -Seconds 10
    $state = az postgres flexible-server show --resource-group $rg --name $pgName --query "state" -o tsv
    Write-Host "  Postgres state: $state"
} while ($state -ne "Ready")
Write-Host "  Postgres is Ready." -ForegroundColor Green

$newIp = az network public-ip show --resource-group $rg --name $natIpName --query "ipAddress" -o tsv
Write-Host "`n=== Done. ===" -ForegroundColor Cyan
Write-Host "New outbound IP: $newIp (expected to differ from last time)"
Write-Host "Give the Container App a minute to pick up connectivity, then log in at quantalyze.me."
