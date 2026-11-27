FROM php:8.2-fpm

WORKDIR /var/www

RUN apt-get update && apt-get install -y \
    git curl zip unzip libpng-dev libonig-dev libxml2-dev libzip-dev

RUN docker-php-ext-install pdo pdo_mysql zip pcntl opcache
RUN pecl install redis && docker-php-ext-enable redis

# Configure OPcache
RUN echo "opcache.enable=1" >> /usr/local/etc/php/conf.d/opcache.ini \
    && echo "opcache.enable_cli=1" >> /usr/local/etc/php/conf.d/opcache.ini \
    && echo "opcache.memory_consumption=128" >> /usr/local/etc/php/conf.d/opcache.ini \
    && echo "opcache.interned_strings_buffer=8" >> /usr/local/etc/php/conf.d/opcache.ini \
    && echo "opcache.max_accelerated_files=10000" >> /usr/local/etc/php/conf.d/opcache.ini \
    && echo "opcache.validate_timestamps=1" >> /usr/local/etc/php/conf.d/opcache.ini \
    && echo "opcache.revalidate_freq=2" >> /usr/local/etc/php/conf.d/opcache.ini \
    && echo "opcache.fast_shutdown=1" >> /usr/local/etc/php/conf.d/opcache.ini \
    && echo "variables_order=EGPCS" >> /usr/local/etc/php/conf.d/opcache.ini

RUN printf '<?php\ntry {\n  $h = getenv("DB_HOST");\n  if ($h) {\n    $p = getenv("DB_PORT") ?: "3306";\n    $d = getenv("DB_DATABASE") ?: "ticketing_prod";\n    $u = getenv("DB_USERNAME") ?: "root";\n    $w = (string)getenv("DB_PASSWORD");\n    $pdo = new PDO("mysql:host=$h;port=$p", $u, $w, [PDO::ATTR_TIMEOUT => 5]);\n    $pdo->exec("CREATE DATABASE IF NOT EXISTS `$d` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");\n  }\n} catch (Throwable $e) {\n  fwrite(STDERR, "DB init note: " . $e->getMessage() . "\\n");\n}\n' > /usr/local/bin/init-db.php

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

COPY . .

# Run composer install at build time
RUN mkdir -p bootstrap/cache storage && composer install --no-interaction --no-dev --prefer-dist --optimize-autoloader

# HTTP runtime: nginx on :8000 in front of php-fpm, replacing the single threaded
# `php artisan serve`. Startup steps (APP_KEY check, migrations, post-migrate hooks) are in
# docker/runtime/start.sh. Compose `command:` overrides (queue, scheduler, reverb) still replace CMD.
RUN apt-get update && apt-get install -y --no-install-recommends nginx \
    && rm -rf /var/lib/apt/lists/* /etc/nginx/sites-enabled/default \
    && ln -sf /dev/stdout /var/log/nginx/access.log \
    && ln -sf /dev/stderr /var/log/nginx/error.log

COPY docker/runtime/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/runtime/php-fpm.conf /usr/local/etc/php-fpm.d/zz-app.conf
COPY docker/runtime/start.sh /usr/local/bin/start-app
# Strip Windows line endings in case the files were checked out with CRLF.
RUN sed -i 's/\r$//' /usr/local/bin/start-app /etc/nginx/conf.d/default.conf /usr/local/etc/php-fpm.d/zz-app.conf \
    && chmod +x /usr/local/bin/start-app

ENV PHP_FPM_MAX_CHILDREN=10
EXPOSE 8000

CMD ["start-app"]
