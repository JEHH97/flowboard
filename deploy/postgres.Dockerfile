FROM postgres:17.12-alpine3.24

# Keep Alpine 3.24 packages patched and drop gosu: Compose runs this container
# as the postgres UID, so the root-only privilege drop helper is not needed.
RUN apk upgrade --no-cache \
  && rm -f /usr/local/bin/gosu
