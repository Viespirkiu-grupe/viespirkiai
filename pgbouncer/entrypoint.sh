#!/bin/sh
set -e

cat > /home/pgbouncer/etc/userlist.txt << EOF
"${POSTGRES_USER}" "${POSTGRES_PASSWORD}"
EOF

cat > /home/pgbouncer/etc/pgbouncer.ini << EOF
[databases]
${POSTGRES_DB} = host=${POSTGRES_HOST} port=5432 dbname=${POSTGRES_DB}

[pgbouncer]
listen_addr = 0.0.0.0
listen_port = 6432
auth_file = /home/pgbouncer/etc/userlist.txt
auth_type = md5
pool_mode = transaction
max_client_conn = 200
default_pool_size = 50
log_connections = 0
log_disconnections = 0
EOF

exec pgbouncer /home/pgbouncer/etc/pgbouncer.ini
