#!/bin/bash
echo "Testing TCP connectivity to quantalyze-postgres.private.postgres.database.azure.com:5432 ..."
timeout 8 bash -c "echo > /dev/tcp/quantalyze-postgres.private.postgres.database.azure.com/5432" 2>&1
echo "Result: $?"
echo "---"
echo "DNS resolution check:"
getent hosts quantalyze-postgres.private.postgres.database.azure.com 2>&1 || echo "DNS resolution FAILED"
