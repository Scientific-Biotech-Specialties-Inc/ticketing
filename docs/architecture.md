# System Architecture & Topology

The **Enterprise Ticketing System** is engineered as a distributed, event-driven microservices architecture. Each business capability is encapsulated within an autonomous service with dedicated responsibilities, decoupled communication patterns, and tailored persistence engines.

---

## High-Level Architecture Topology

```
+---------------------------------------------------------------------------------------------------+
|                                      CLIENT LAYER                                                 |
|  - Customer Portal SPA: [frontend/web](file:///c:/Users/Shelley/Desktop/projects/php/enterprise-ticketing-system/frontend/web) (Port 5006, Path: /)                     |
|  - Employee / Admin SPA: [frontend/web](file:///c:/Users/Shelley/Desktop/projects/php/enterprise-ticketing-system/frontend/web) (Port 5005, Path: /ticketing/)        |
+-------------------------------------------------+-------------------------------------------------+
                                                  |
                                                  v  HTTP (Port 80/443) & WebSockets (/app/*, /messaging-app/*)
+-------------------------------------------------+-------------------------------------------------+
|                                 API GATEWAY & REVERSE PROXY                                       |
|  - [nginx.conf](file:///c:/Users/Shelley/Desktop/projects/php/enterprise-ticketing-system/nginx.conf) / [nginx.prod.conf](file:///c:/Users/Shelley/Desktop/projects/php/enterprise-ticketing-system/nginx.prod.conf)                     |
+---+----------------------+----------------------+----------------------+----------------------+---+
    |                      |                      |                      |                      |
    | /api/.../customer    | /api/.../ticket      | /api/.../attachment  | /api/.../messaging   | /api/.../analytics
    v                      v                      v                      v                      v
+--------------------+ +--------------------+ +--------------------+ +--------------------+ +--------------------+
| customer-service   | | ticket-service     | | attachment-service | | messaging-service  | | analytics-service  |
| Port: 8001 -> 8000 | | Port: 8002 -> 8000 | | Port: 8006 -> 8000 | | Port: 8007 -> 8000 | | Port: 8004 -> 8000 |
| FastCGI: 9000      | | FastCGI: 9000      | | FastCGI: 9000      | | FastCGI: 9000      | | FastCGI: 9000      |
| [app/](file:///c:/Users/Shelley/Desktop/projects/php/enterprise-ticketing-system/services/customer-service/app)             | | [app/](file:///c:/Users/Shelley/Desktop/projects/php/enterprise-ticketing-system/services/ticket-service/app)             | | [app/](file:///c:/Users/Shelley/Desktop/projects/php/enterprise-ticketing-system/services/attachment-service/app)             | | [app/](file:///c:/Users/Shelley/Desktop/projects/php/enterprise-ticketing-system/services/messaging-service/app)             | | [app/](file:///c:/Users/Shelley/Desktop/projects/php/enterprise-ticketing-system/services/analytics-service/app)             |
+---------+----------+ +---------+----------+ +---------+----------+ +---------+----------+ +---------+----------+
          |                      |                      |                      |                      |
          |                      |                      +--------+             |                      |
          |                      |                               |             |                      |
          v                      v                               v             v                      v
+---------------------------------------------------------------------------------------------------+
|                                  SHARED INFRASTRUCTURE LAYER                                      |
|  - MySQL 8 ([capstone-db](file:///c:/Users/Shelley/Desktop/projects/php/enterprise-ticketing-system/docker-compose.yml#L3-L25)): Relational DB on 33061:3306                                  |
|  - Redis 7 ([capstone-redis](file:///c:/Users/Shelley/Desktop/projects/php/enterprise-ticketing-system/docker-compose.yml#L26-L35)): Cache, Queue, and Pub/Sub on 6379:6379                   |
|  - MongoDB 7 ([capstone-mongodb](file:///c:/Users/Shelley/Desktop/projects/php/enterprise-ticketing-system/docker-compose.yml#L327-L346)): Document store for chat on 27017:27017             |
|  - ClamAV ([capstone-clamav](file:///c:/Users/Shelley/Desktop/projects/php/enterprise-ticketing-system/docker-compose.yml#L275-L284)): Antivirus socket daemon on 3310:3310                  |
|  - Core Reverb ([capstone-reverb](file:///c:/Users/Shelley/Desktop/projects/php/enterprise-ticketing-system/docker-compose.yml#L36-L57)): WebSockets on 6001:6001                              |
|  - Messaging Reverb ([capstone-messaging-reverb](file:///c:/Users/Shelley/Desktop/projects/php/enterprise-ticketing-system/docker-compose.yml#L347-L371)): WebSockets on 6002:6002             |
+---------------------------------------------------------------------------------------------------+
```

---

## Core Microservice Subsystems

### 1. `customer-service` (Identity, Authentication & Provisioning)
* **Code Location**: [services/customer-service/](file:///c:/Users/Shelley/Desktop/projects/php/enterprise-ticketing-system/services/customer-service)
* **Internal Port**: 8000 (FastCGI 9000) | **Host Port**: 8001
* **Primary Responsibilities**:
  * Centralized identity provider and OAuth2 server using Laravel Passport.
  * Manages `clients` (customers/tenants) and `employees` (technicians, CS agents, admins).
  * Implements [PolymorphicUserProvider.php](file:///c:/Users/Shelley/Desktop/projects/php/enterprise-ticketing-system/services/customer-service/app/Auth/PolymorphicUserProvider.php) to authenticate disparate user models through a single auth pipeline.
  * Dispenses RSA public encryption keys via `/encryption-key` and verifies RSA-encrypted credentials on login and password reset.
  * Manages refresh tokens, OTP verification, and password reset flows.
* **Storage**: MySQL (`clients`, `clients_credentials`, `employees`, `refresh_tokens`, `password_reset_otps`, `oauth_*`) and Redis (session, rate limiting, and token revocation).

### 2. `ticket-service` (Core Ticket Lifecycle & SLA Engine)
* **Code Location**: [services/ticket-service/](file:///c:/Users/Shelley/Desktop/projects/php/enterprise-ticketing-system/services/ticket-service)
* **Internal Port**: 8000 (FastCGI 9000) | **Host Port**: 8002
* **Primary Responsibilities**:
  * Complete lifecycle management for internal and customer-submitted tickets.
  * Status transitions (Open, Pending Assignment, In Progress, On Hold, Proof Submitted, Resolved, Closed, Discarded).
  * SLA tracking engine: calculates expected response and resolution deadlines based on department, problem category, and machine severity.
  * Ticket assignment and reassignment approval workflow.
  * Proof of completion submission and review.
  * Work log tracking and audit log recording.
* **Storage**: MySQL (`tickets`, `ticket_assignments`, `proof_of_completion`, `slas`, `sla_rules`, `ticket_audit_logs`, `work_logs`) and Redis (query cache, incoming queue caching, Reverb broadcast driver).

### 3. `attachment-service` (Secure Document Management)
* **Code Location**: [services/attachment-service/](file:///c:/Users/Shelley/Desktop/projects/php/enterprise-ticketing-system/services/attachment-service)
* **Internal Port**: 8000 (FastCGI 9000) | **Host Port**: 8006
* **Primary Responsibilities**:
  * Direct file uploads for ticket evidence and proof of completion.
  * Enforces an antivirus pipeline: streams incoming files to ClamAV (`capstone-clamav:3310`) before persisting to permanent storage.
  * Generates secure storage paths and provides asset download endpoints.
* **Storage**: Local/Docker volume for files (`storage/app/public`), MySQL (`ticket_attachments`, `proof_of_completion`).

### 4. `messaging-service` (Real-Time Communication)
* **Code Location**: [services/messaging-service/](file:///c:/Users/Shelley/Desktop/projects/php/enterprise-ticketing-system/services/messaging-service)
* **Internal Port**: 8000 (FastCGI 9000) | **Host Port**: 8007
* **Primary Responsibilities**:
  * Real-time conversational messaging between customers, customer support (CS), and assigned technicians per ticket.
  * Edit history, soft deletion, and message auditing.
  * Broadcasts live chat events to WebSocket clients via dedicated Reverb instance (`messaging-reverb:6002`).
* **Storage**: MongoDB (`messages` collection) for high-throughput, unstructured message transcripts; MySQL for cross-referencing user identities.

### 5. `analytics-service` (CSAT & Predictive Intelligence)
* **Code Location**: [services/analytics-service/](file:///c:/Users/Shelley/Desktop/projects/php/enterprise-ticketing-system/services/analytics-service)
* **Internal Port**: 8000 (FastCGI 9000) | **Host Port**: 8004
* **Primary Responsibilities**:
  * Gathers customer satisfaction (CSAT) ratings and feedback following ticket resolution.
  * Calculates predictive analytics: forecasted ticket volume, peak support days, technician performance, equipment failure risks, escalation probabilities, and recurring issue detection.
* **Storage**: MySQL (`customer_feedback`, `ticket_volume_snapshots`, `employee_performance_analytics`, `equipment_risk_analytics`, `escalation_risk_snapshots`, `root_cause_analytics`, `recurring_issue_analytics`).

### 6. `notification-service` (Event Dispatcher)
* **Code Location**: [services/notification-service/](file:///c:/Users/Shelley/Desktop/projects/php/enterprise-ticketing-system/services/notification-service)
* **Internal Port**: 8000 (FastCGI 9000) | **Host Port**: 8003
* **Primary Responsibilities**:
  * Dedicated event consumer for dispatching asynchronous email notifications, SMS alerts, and browser push alerts across ticket updates and SLA warning events.
* **Storage**: MySQL / Redis queue.

### 7. `AI-service` (Automated Triage & Knowledge Base)
* **Code Location**: [services/AI-service/](file:///c:/Users/Shelley/Desktop/projects/php/enterprise-ticketing-system/services/AI-service)
* **Internal Port**: 8000 (FastCGI 9000) | **Host Port**: 8005
* **Primary Responsibilities**:
  * Machine learning and LLM integration for ticket classification, automated priority recommendation, sentiment analysis, and intelligent knowledge base article matching.
* **Storage**: MySQL / Redis.

---

## Gateway Routing & Traffic Distribution

The system utilizes an **Nginx API Gateway** as the single public entrypoint for all frontend web assets and backend microservice routing.

### Nginx Routing Rules ([nginx.conf](file:///c:/Users/Shelley/Desktop/projects/php/enterprise-ticketing-system/nginx.conf))

| Request Pattern | Target Service | Protocol | Description |
| :--- | :--- | :--- | :--- |
| `GET /` | `customer-ticketing-web:5006` | HTTP Proxy | Customer React SPA |
| `GET /ticketing/*` | `ticketing-web:5005` | HTTP Proxy | Employee / Admin React SPA |
| `/api/ticketing/customer/*` | `customer-service:9000` | FastCGI | Auth & User Management |
| `/api/ticketing/ticket/*` | `ticket-service:9000` | FastCGI | Core Ticketing Engine |
| `/api/ticketing/attachment/*` | `attachment-service:9000` | FastCGI | Attachment uploads & binding |
| `/api/ticketing/messaging/*` | `messaging-service:9000` | FastCGI | Live chat REST endpoints |
| `/api/ticketing/analytics/*` | `analytics-service:9000` | FastCGI | CSAT and predictive endpoints |
| `/api/ticketing/notification/*` | `notification-service:9000` | FastCGI | Notification triggers |
| `/api/ticketing/ai/*` | `ai-service:9000` | FastCGI | AI & LLM processing |
| `GET /storage/*` | `attachment-service:8000` | HTTP Proxy | Public media and attachments |
| `GET /app/*` | `reverb:6001` | WebSocket (WSS) | Core ticket status change events |
| `GET /messaging-app/*` | `messaging-reverb:6002` | WebSocket (WSS) | Real-time chat messaging events |

---

## Inter-Service Communication Patterns

### 1. Synchronous Communication (HTTP REST)
* Used when immediate responses are required (e.g., frontend fetching tickets, logging in, or initiating file upload scans).
* Inter-service HTTP calls use internal Docker DNS hostnames (`http://customer-service:8000`, `http://ticket-service:8000`).

### 2. Asynchronous Communication (Redis Queues)
* Used for operations that should not block the client HTTP request lifecycle:
  * Sending email alerts via SMTP (`customer-service-queue`, `ticket-service-queue`).
  * Asynchronous SLA evaluation and notification dispatching.
  * Worker process command: `php artisan queue:work redis --sleep=1 --tries=3 --timeout=90`.

### 3. Real-Time Push (Laravel Reverb & WebSockets)
* Microservices dispatch domain events implementing `ShouldBroadcastNow` or `ShouldBroadcast`.
* Events are published via Redis to two dedicated Laravel Reverb instances:
  * **Core Reverb (`capstone-reverb:6001`)**: Emits `TicketChanged`, `TicketAssigned`, and notification badges.
  * **Messaging Reverb (`capstone-messaging-reverb:6002`)**: Emits `MessageSent`, `MessageUpdated`, and `MessageDeleted` events.
* Frontend connects via `Laravel Echo` with `pusher-js` over WSS/WS to receive real-time UI updates without polling.

---

## Distributed Authentication Flow (`auth.subsystem`)

Cross-service authentication is decoupled using shared cryptographic verification.

### Step-by-Step Flow:

```
[React Client]                           [Nginx Gateway]                   [customer-service]              [ticket-service]
      |                                          |                                  |                              |
  (1) |--- GET /api/ticketing/customer/enc-key ->|                                  |                              |
      |                                          |--- GET /encryption-key --------->|                              |
      |                                          |<-- Return RSA Public Key --------|                              |
      |<-- Return RSA Public Key ----------------|                                  |                              |
      |                                          |                                  |                              |
  (2) |-- Encrypt password via JSEncrypt         |                                  |                              |
  (3) |--- POST /api/ticketing/customer/login -->|                                  |                              |
      |    (username, encrypted_password)        |--- Forward to AuthController --->|                              |
      |                                          |    1. Decrypt via decrypt.rsa    |                              |
      |                                          |    2. Verify credentials         |                              |
      |                                          |    3. Issue OAuth2 JWT token     |                              |
      |<-- Return Bearer Token & User Profile ---|<-- Return Bearer Token ----------|                              |
      |                                          |                                  |                              |
  (4) |--- GET /api/ticketing/ticket/tickets --->|                                  |                              |
      |    (Authorization: Bearer <Token>)       |--- Forward to ticket-service ---------------------------------->|
      |                                          |                                  |    auth.subsystem:           |
      |                                          |                                  |    A. If Employee JWT:       |
      |                                          |                                  |       Verify against central |
      |                                          |                                  |       oauth-public.key &     |
      |                                          |                                  |       check Redis blacklist  |
      |                                          |                                  |    B. If Customer Token:     |
      |                                          |                                  |       Verify via Passport    |
      |                                          |                                  |       local guard (auth:api) |
      |<-- 200 OK Ticket Data -------------------|<-- 200 OK Ticket Data ------------------------------------------|
```

### Critical Files for AI Agents:
* [services/customer-service/app/Http/Controllers/AuthController.php](file:///c:/Users/Shelley/Desktop/projects/php/enterprise-ticketing-system/services/customer-service/app/Http/Controllers/AuthController.php)
* [services/customer-service/app/Http/Middleware/DecryptRsaPayload.php](file:///c:/Users/Shelley/Desktop/projects/php/enterprise-ticketing-system/services/customer-service/app/Http/Middleware/DecryptRsaPayload.php)
* [services/ticket-service/app/Http/Middleware/AuthenticateSubsystem.php](file:///c:/Users/Shelley/Desktop/projects/php/enterprise-ticketing-system/services/ticket-service/app/Http/Middleware/AuthenticateSubsystem.php)
* [services/ticket-service/app/Http/Middleware/VerifyEmployeeJwt.php](file:///c:/Users/Shelley/Desktop/projects/php/enterprise-ticketing-system/services/ticket-service/app/Http/Middleware/VerifyEmployeeJwt.php)
* [frontend/web/src/utils/rsa.js](file:///c:/Users/Shelley/Desktop/projects/php/enterprise-ticketing-system/frontend/web/src/utils/rsa.js)
