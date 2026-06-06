FROM postgres:18

RUN apt-get update \
    && apt-get install -y \
        postgresql-18-repack \
        postgresql-18-postgis-3 \
    && rm -rf /var/lib/apt/lists/*
