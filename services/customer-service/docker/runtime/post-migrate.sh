# Sourced by start.sh after migrations (customer-service only).
# Seeders and Passport keys. Best effort, as before the php-fpm switch.
php artisan db:seed --force || true
if [ ! -f storage/oauth-private.key ]; then
    php artisan passport:keys --force || true
fi
