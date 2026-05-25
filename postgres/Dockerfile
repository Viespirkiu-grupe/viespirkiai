FROM postgres:17.9

RUN apt-get update \
    && apt-get install -y \
        postgresql-17-repack \
        postgresql-17-postgis-3 \
    && rm -rf /var/lib/apt/lists/*
