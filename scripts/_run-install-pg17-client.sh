#!/bin/bash
set -e
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg lsb-release
install -d /usr/share/postgresql-common/pgdg
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list
apt-get update -qq
apt-get install -y -qq postgresql-client-17
/usr/lib/postgresql/17/bin/pg_dump --version
/usr/lib/postgresql/17/bin/psql --version
