#!/bin/sh
# Selects which service this container runs. Cloud Run sets ROLE per service.
set -eu

case "${ROLE:-}" in
  api)
    exec node apps/api/dist/server.js
    ;;
  worker)
    exec node apps/worker/dist/server.js
    ;;
  *)
    echo "ROLE must be set to 'api' or 'worker' (got: '${ROLE:-<unset>}')" >&2
    exit 1
    ;;
esac
