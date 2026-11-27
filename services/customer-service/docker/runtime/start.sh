#!/bin/bash
# Container start for the HTTP service: prepare the app, migrate, then run php-fpm (PHP workers)
# and nginx (HTTP on :8000) side by side. Replaces the single threaded `php artisan serve`.
#
# Queue workers, schedulers and Reverb override CMD in compose, so they never run this.
# Identical in every service (services/*/docker/runtime/). CI fails if the copies drift apart.
# Service specific steps (seeders, Passport keys) live in docker/runtime/post-migrate.sh.
set -euo pipefail
cd /var/www

if [ ! -f .env ] && [ -f .env.example ]; then
    cp .env.example .env
fi

# APP_KEY: production must provide a stable key through the environment. A key generated here
# would change with every new container and break encrypted data, sessions and queued jobs.
if [ -z "${APP_KEY:-}" ]; then
    if [ "${APP_ENV:-}" = "production" ]; then
        echo "FATAL: APP_KEY is not set. Give this service a stable APP_KEY (see .env.production.example)." >&2
        exit 1
    fi
    if [ -f .env ] && grep -q '^APP_KEY=$' .env; then
        php artisan key:generate --force
    fi
fi

php /usr/local/bin/init-db.php

# No "|| true": a failed migration stops the container instead of serving an unexpected schema.
php artisan migrate --force

if [ -f docker/runtime/post-migrate.sh ]; then
    # shellcheck source=/dev/null
    . docker/runtime/post-migrate.sh
fi

# Setup above ran as root. php-fpm workers run as www-data and must write logs and caches and
# read generated keys.
mkdir -p storage/framework/cache/data storage/framework/sessions storage/framework/views \
    storage/logs bootstrap/cache
chown -R www-data:www-data storage bootstrap/cache

php-fpm &
nginx -g 'daemon off;' &

# Forward stop signals to both processes as QUIT, the graceful shutdown signal for php-fpm and
# nginx (finish in-flight requests). The php-fpm base image sets STOPSIGNAL SIGQUIT, so
# `docker stop` sends QUIT; TERM and INT are handled the same way.
stopping=0
trap 'stopping=1; kill -QUIT $(jobs -p) 2>/dev/null || true' QUIT TERM INT

# If either process exits on its own, stop the other and exit non zero, so the orchestrator
# restarts the container. A requested stop (signal above) exits 0.
set +e
wait -n
status=$?
kill -QUIT $(jobs -p) 2>/dev/null
wait
if [ "$stopping" = 1 ]; then
    exit 0
fi
exit "$status"
