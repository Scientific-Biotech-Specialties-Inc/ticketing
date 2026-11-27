# Sourced by start.sh after migrations (ticket-service only).
# Reference data (statuses, priorities). Best effort, as before the php-fpm switch.
php artisan db:seed --class=TicketReferenceSeeder --force || true
