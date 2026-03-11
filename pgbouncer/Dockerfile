FROM alpine:3.19
RUN apk add --no-cache pgbouncer
RUN adduser -D pgbouncer && mkdir -p /home/pgbouncer/etc && chown pgbouncer /home/pgbouncer/etc
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
USER pgbouncer
ENTRYPOINT ["/entrypoint.sh"]
