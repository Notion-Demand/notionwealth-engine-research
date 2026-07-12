#!/bin/bash
set -e
IPV4=$(getent ahostsv4 db.ysoqazybquevpenjyqqk.supabase.co | head -1 | awk '{print $1}')
echo "Resolved IPv4: $IPV4"
if ! grep -q "db.ysoqazybquevpenjyqqk.supabase.co" /etc/hosts; then
  echo "$IPV4 db.ysoqazybquevpenjyqqk.supabase.co" >> /etc/hosts
fi
cat /etc/hosts | grep supabase
getent ahosts db.ysoqazybquevpenjyqqk.supabase.co
