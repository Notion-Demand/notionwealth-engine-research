# Step 3 of 3 for fully exiting Azure: deletes the ENTIRE quantalyze-prod-rg
# resource group -- Postgres, Blob Storage, Container App, Container Apps
# Environment, ACR, VNet, DNS zone, App Insights, everything.
#
# DO NOT RUN THIS until you've confirmed Step 2's backup file (Postgres dump
# + blob contents) actually downloaded from Cloud Shell and looks right
# (non-trivial file size, dump file opens/lists tables with pg_restore -l).
#
# This requires typing the resource group's name to confirm -- there is no
# undo once the deletion completes. The GitHub Actions deploy workflow will
# start failing after this (nothing left to deploy to) -- that's expected
# and harmless, just a red X in Actions until you rebuild.

$ErrorActionPreference = "Stop"
$rg = "quantalyze-prod-rg"

Write-Host "=== Step 3: FULL TEARDOWN of $rg ===" -ForegroundColor Red
Write-Host "This deletes everything in this resource group. Confirm you have a verified backup before continuing." -ForegroundColor Yellow

$confirmation = Read-Host "`nType the resource group name exactly ($rg) to proceed"
if ($confirmation -ne $rg) {
    Write-Host "Confirmation did not match -- aborting. Nothing was deleted." -ForegroundColor Yellow
    exit 1
}

Write-Host "`nDeleting resource group $rg (this runs in the background; can take several minutes)..."
az group delete --name $rg --yes --no-wait

Write-Host "`nDeletion started. Check progress any time with:"
Write-Host "  az group exists --name $rg"
Write-Host "(returns 'true' while still deleting, 'false' once fully gone)"
