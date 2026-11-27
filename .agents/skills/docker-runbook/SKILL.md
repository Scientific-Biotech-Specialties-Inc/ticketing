---
name: docker-runbook
description: Manage, debug, and run commands across the multi-container Docker Compose environment. Use when executing database migrations, reviewing service logs, restarting daemons (ClamAV, Reverb), or troubleshooting container networking.
---

# Docker Runbook & Container Operations

This skill outlines operational procedures and common commands for managing the multi-container microservice stack defined in `docker-compose.yml`.

## 1. Container Topology

| Service Container | Port Mapping | Description |
| :--- | :--- | :--- |
| `nginx` | 80, 443 | Reverse proxy gateway routing `/api/*` and serving static frontend |
| `frontend` | 5005, 5006 | Vite React development server (`customer` / `employee`) |
| `customer-service` | 8001:8000 | Customer identity, authentication, client profiles |
| `ticket-service` | 8002:8000 | Core ticket lifecycle, SLA engine |
| `notification-service`| 8003:8000 | Reverb WebSockets & email dispatch worker |
| `analytics-service` | 8004:8000 | CSAT ratings and analytics reporting |
| `ai-service` | 8005:8000 | Google Gemini 2.0 Flash AI assistant |
| `attachment-service` | 8006:8000 | Uploads & ClamAV scanner client |
| `messaging-service` | 8007:8000 | Real-time ticket chat messaging (MongoDB 7) |
| `capstone-db` | 33061:3306 | MySQL 8 per-service database |
| `capstone-redis` | 6379:6379 | Redis cache & session store |
| `capstone-clamav` | 3310:3310 | ClamAV antivirus daemon |
| `reverb` | 6001:6001 | Laravel Reverb WebSocket server |
| `mongo` | 27017:27017 | MongoDB 7 chat storage |


---

## 2. Microservice Database Migrations

To execute migrations inside a specific microservice container:

```bash
# Run migration for AI Service
docker compose exec ai-service php artisan migrate

# Run migration for Ticketing Service
docker compose exec ticketing-service php artisan migrate

# Run migration for Auth Service
docker compose exec auth-service php artisan migrate

# Run migration for Attachment Service
docker compose exec attachment-service php artisan migrate
```

To run all microservice migrations in sequence:
```bash
$services = @("auth-service", "ticketing-service", "asset-service", "attachment-service", "audit-service", "notification-service", "ai-service")
foreach ($s in $services) {
    docker compose exec $s php artisan migrate --force
}
```

---

## 3. Running Microservice Test Suites

Execute PHPUnit / Pest tests inside any microservice:

Tests run only on isolated MySQL databases whose names end in `_test` (`ticketing_system_test`, `analytics_service_test`), never on `ticketing_system`; each suite aborts before migrating otherwise (spec 0050). Create them once with the stack up:

```bash
sh scripts/create-test-databases.sh
```

Parity golden files for the reporting move (spec 0050) are captured from ticket-service on the commit before a slice's removals:

```bash
docker compose exec -e PARITY_CAPTURE=1 ticket-service php artisan test --filter=ParityCapture
```

```bash
# Test Ticketing Service
docker compose exec ticketing-service php artisan test

# Test AI Service
docker compose exec ai-service php artisan test

# Test Auth Service
docker compose exec auth-service php artisan test
```

---

## 4. ClamAV Antivirus Daemon Operations

* **Status Check**: Verify the ClamAV daemon is listening on port 3310:
  ```bash
  docker compose logs -f capstone-clamav
  ```
* **Test Antivirus Detection**: In `attachment-service`, submit the standard EICAR test string:
  ```text
  X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*
  ```
  The attachment service must reject the upload with HTTP 422 Unprocessable Entity and immediately delete the temp file.

---

## 5. Nginx Gateway Troubleshooting

* **Test Nginx Configuration**:
  ```bash
  docker compose exec nginx nginx -t
  ```
* **Hot Reload Routing**:
  ```bash
  docker compose exec nginx nginx -s reload
  ```
* **View Gateway Access & Error Logs**:
  ```bash
  docker compose logs -f nginx
  ```

---

## 6. Real-Time Reverb WebSocket Operations

* **Check Reverb Process**:
  ```bash
  docker compose exec notification-service php artisan reverb:status
  ```
* **Restart Reverb Server**:
  ```bash
  docker compose restart reverb
  ```
