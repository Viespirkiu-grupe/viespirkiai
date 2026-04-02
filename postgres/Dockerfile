FROM postgres:17

RUN apt-get update \
    && apt-get install -y \
        curl \
        postgresql-17-repack \
        postgresql-17-postgis-3 \
    && curl -L "https://github.com/paradedb/paradedb/releases/download/v0.22.3/postgresql-17-pg-search_0.22.3-1PARADEDB-noble_amd64.deb" \
        -o /tmp/pg_search.deb \
    && apt-get install -y /tmp/pg_search.deb \
    && rm -rf /var/lib/apt/lists/* /tmp/*.deb
