---
description: Coding standards, architectural invariants, and security rules for AI assistants in the enterprise ticketing system repository
globs: **/*
---

# Enterprise Ticketing System AI Coding Rules

When working on this repository, all AI coding assistants must strictly adhere to the following architectural invariants and coding standards:

## 1. Security & Cryptography Invariants
* **Client-Side RSA Encryption**: Never transmit plaintext user passwords over HTTP. All password payloads in the frontend must be encrypted with the public RSA key via `encryptPayload()` in `frontend/web/src/utils/rsa.js`.
* **Backend RSA Decryption**: Any backend route accepting credentials must apply the `decrypt.rsa` middleware (`App\Http\Middleware\DecryptRsaPayload`).
* **Antivirus Scanning**: Never bypass ClamAV on file uploads. All uploads in `attachment-service` must be streamed to the ClamAV daemon (`capstone-clamav:3310`) prior to persistence. Quarantined/infected files must be deleted immediately.
* **Shared OAuth Token Verification**: Downstream microservices (`ticket-service`, `analytics-service`) must verify caller identity using `AuthenticateSubsystem` and the shared public key (`storage/oauth-public.key`).

## 2. Microservice Boundaries & Persistence
* **No Direct DB Coupling**: Do not query or modify another service's private tables directly. Each service must maintain ownership over its bounded domain.
* **Chat Persistence**: Real-time chat messages must strictly reside in MongoDB 7 (`messaging-service`), never in MySQL.
* **Non-Blocking Cache Invalidation**: When modifying tickets or statuses, never use blocking `KEYS *` in Redis. Always use non-blocking `SCAN` chunking (see `TicketController::clearTicketCaches()`).

## 3. Architecture & Refactoring Standards
* **Thin Controllers**: Do not add monolithic logic to `TicketController.php`. Extract new business logic into dedicated service classes in `app/Services/`.
* **Real-Time WebSockets**: When updating ticket state, always dispatch `TicketChanged` to the Reverb server (Port 6001). When updating chat messages, broadcast on `presence-ticket-chat.{ticket_id}` (Port 6002).
* **Dual-Mode Frontend Parity**: The React frontend (`frontend/web`) runs in both `employee` mode (Port 5005, `/ticketing/`) and `customer` mode (Port 5006, `/`). Any changes to shared components or routes must not break either mode.

## 4. Operational & Code Hygiene
* **Preserve Documentation**: Do not remove existing docstrings, PHPDoc blocks, or comments unless directly made obsolete.
* **No Spec References in Code Comments**: Never reference specification numbers, spec titles, or spec file paths (e.g., `spec 0026`, `Spec 0050`, `docs/specs/...`) in code comments or docblocks. Describe the technical behavior or rationale directly instead.
* **Timestamped Migrations**: All schema modifications must be scripted via standard Laravel timestamped migrations with appropriate foreign key cascade rules (`ticket_audit_logs` foreign keys must remain nullable and non-cascading).
* **Nginx Routing Parity**: If a new microservice route prefix is added, ensure corresponding FastCGI / HTTP proxy directives are added to both `nginx.conf` and `nginx.prod.conf`.
