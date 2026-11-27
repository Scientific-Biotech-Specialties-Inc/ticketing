#!/usr/bin/env sh
# Creates the isolated MySQL test databases the service test suites run against (spec 0050).
#
#   ticketing_system_test    ticket-service (phpunit.xml forces it)
#   analytics_service_test   analytics-service (phpunit.xml forces it)
#
# Tests never run on ticketing_system: each suite's base TestCase aborts before migrating when the
# connected database name does not end in _test. Safe to run more than once.
#
# Usage, from the repo root with the compose stack up:
#   sh scripts/create-test-databases.sh
set -eu

docker compose exec -T db sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e "
CREATE DATABASE IF NOT EXISTS ticketing_system_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS analytics_service_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
"'

echo "Test databases ready: ticketing_system_test, analytics_service_test"
