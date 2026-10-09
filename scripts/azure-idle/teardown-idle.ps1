# Tears down the idle-cost resources for Quantalyze's Azure backend.
# Run this when you're done using the app.
#
# What it does:
#   1. Stops the Postgres Flexible Server (compute billing stops; storage keeps billing, small).
#   2. Discovers which subnet(s) are currently attached to the NAT Gateway and saves
#      them to nat-gateway-state.json (so bring-up.ps1 knows what to reattach, without
#      anyone having to hardcode subnet names).
#   3. Detaches the NAT Gateway from those subnet(s).
#   4. Deletes the NAT Gateway.
#   5. Deletes the NAT Gateway's static public IP.
#
# Safe to run repeatedly. Confirmed safe to change the outbound IP each time:
# quantalyze.me's DNS points at Vercel, not this IP, and the Vercel frontend calls
# the Container App via its own hostname -- nothing external depends on this IP
# staying fixed (see chat notes if that ever changes, e.g. adding a data provider
# that requires IP allow-listing on outbound calls).
#
# Requires: az CLI, already logged in (az login), correct subscription selected.

$ErrorActionPreference = "Stop"

$rg = "quantalyze-prod-rg"
$vnet = "quantalyze-prod-vnet"
$natGwName = "quantalyze-nat-gateway"
$natIpName = "quantalyze-nat-gateway-ip"
$pgName = "quantalyze-postgres"
$stateFile = "$PSScriptRoot\nat-gateway-state.json"

Write-Host "=== Quantalyze: tearing down idle-cost resources ===" -ForegroundColor Cyan

Write-Host "`nStopping Postgres ($pgName)..."
az postgres flexible-server stop --resource-group $rg --name $pgName | Out-Null
Write-Host "  Postgres stop requested." -ForegroundColor Green

Write-Host "`nDiscovering subnets attached to NAT Gateway ($natGwName)..."
$attachedSubnets = az network vnet subnet list `
  --resource-group $rg --vnet-name $vnet `
  --query "[?natGateway!=null].name" -o tsv

if (-not $attachedSubnets) {
    Write-Warning "No subnets found attached to $natGwName. Saving empty state -- check manually before running bring-up.ps1."
}

$attachedSubnetsArray = @($attachedSubnets -split "`n" | Where-Object { $_.Trim() -ne "" })
$attachedSubnetsArray | ConvertTo-Json | Set-Content -Path $stateFile
Write-Host "  Saved attached subnet(s) to state file: $($attachedSubnetsArray -join ', ')" -ForegroundColor Green

foreach ($subnet in $attachedSubnetsArray) {
    Write-Host "`nDetaching NAT Gateway from subnet: $subnet"
    az network vnet subnet update `
      --resource-group $rg --vnet-name $vnet --name $subnet `
      --remove natGateway | Out-Null
    Write-Host "  Detached." -ForegroundColor Green
}

Write-Host "`nDeleting NAT Gateway ($natGwName)..."
az network nat gateway delete --resource-group $rg --name $natGwName
Write-Host "  Deleted." -ForegroundColor Green

Write-Host "`nDeleting static IP ($natIpName)..."
az network public-ip delete --resource-group $rg --name $natIpName
Write-Host "  Deleted." -ForegroundColor Green

Write-Host "`n=== Done. Postgres stopped, NAT Gateway + IP removed. ===" -ForegroundColor Cyan
