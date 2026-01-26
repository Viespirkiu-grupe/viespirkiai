FROM postgres:17

RUN apt update \
    && apt install -y \
    postgresql-17-repack \
    postgresql-17-postgis-3 \
    && rm -rf /var/lib/apt/lists/*
