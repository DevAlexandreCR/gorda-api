# Gorda API Agents

This document explains the agents (long-running services, jobs, and helper modules) that make up the Gorda automation stack. Each agent encapsulates specific responsibilities so the team can reason about scaling, alerting, and on-call runbooks.

## 1. Runtime Agents

### 1.1 HTTP + Socket Hub (`src/app.ts`)
- Boots the Express server, HTTPS mirror, and attaches Socket.IO.
- Wires controllers under `/src/Api/Controllers/**` for WhatsApp webhooks, notifications, polygon uploads, and admin dashboard routes.
- Registers Sentry, CORS, static assets, and JSON parsing middleware.
- Owns the lifecycle of WhatsApp client instances (see below) via the dependency `Store` + `Container` bootstrap.

### 1.2 WhatsApp Client Agent (`src/Services/whatsapp/WhatsAppClient.ts`)
- Spins up one instance per configured `WpClient` entry.
- Bridges outbound messages from repositories/services to WhatsApp transports (Baileys, whatsapp-web.js, or official API depending on client metadata).
- Emits session state (QR, connection status, events) to Socket.IO for the admin UI under `wpServices[client.id]`.
- Delegates message classification to the chatbot service and persists audit trails via repositories.

### 1.3 Chatbot Orchestrator (`src/Services/chatBot/**`)
- Parses inbound `ChatBotMessage` payloads, routes them through `MessagesEnum`, and calls the correct handler strategy.
- Relies on repository interfaces (`ChatRepository`, `ClientRepository`, etc.) to pull context before formulating replies.
- Pushes follow-up work to the BullMQ queues when a conversation requires async processing (e.g., fee recalculation, driver search).

### 1.4 Store Singleton (`src/Services/store/Store.ts`)
- Caches branches, WhatsApp clients, and settings so that the Socket/HTTP layers can read them without repeating DB calls.
- Emits hydrated data into memory upon app start (`store.getBranches()`, `store.getWpClients()` in `app.ts`).
- Acts as a central registry for downstream agents needing tenant-level configuration.

## 2. Background Jobs (`src/Jobs`)

| Job | File | Purpose | Trigger |
| --- | --- | --- | --- |
| RemoveConnectedDrivers | `RemoveConnectedDrivers.ts` | Clears lingering driver sessions to prevent ghost availability. | Cron via `node-cron` in `Schedule.ts`.
| CloseSessionsJob | `CloseSessionsJob.ts` | Auto-closes stale chat sessions and notifies admins. | Cron.
| PopulateMetrics | `PopulateMetrics.ts` | Aggregates usage metrics into analytics tables or Firebase. | Cron / manual.
| SetDynamicMinFeeJob | `SetDynamicMinFeeJob.ts` | Adjusts minimum ride fee based on demand windows. | Cron.
| SetDynamicMultiplierFeeJob | `SetDynamicMultiplierFeeJob.ts` | Maintains surge multipliers per branch. | Cron.
| RemoveConnectedDrivers | `RemoveConnectedDrivers.ts` | Runs both as scheduled task and callable helper for incident response. | Cron + manual.

`Schedule.ts` exports the cron definitions that wire these jobs to `node-cron`. Each job usually coordinates with repositories (`SessionRepository`, `DriverRepository`, etc.) and may enqueue notifications through WhatsApp or Firebase.

## 3. Queue Workers (`src/Services/queue`)

- Built on BullMQ (`bullmq` dependency) for Redis-backed background processing.
- Typical queues: message delivery retries, Firebase notifications, large polygon/KML imports, and heavy reporting tasks.
- Workers pull helpers from `/src/Helpers` (file I/O, date utilities) and persist transactional data via Sequelize models in `/src/Models`.
- Configure new workers by extending the base queue service and registering them inside the container so they share logging and configuration.

## 4. Data / Persistence Agents

### 4.1 Sequelize Layer (`src/Database`)
- `sequelize.ts` exports the configured Sequelize instance (PostgreSQL driver). Migration files live under `Database/Migrations` while seeders reflect initial data loads.
- Models under `/src/Models` adhere to interfaces in `/src/Interfaces`, ensuring that services stay strongly typed.

### 4.2 Repositories (`src/Repositories`)
- Each repository (`ClientRepository`, `PlaceRepository`, etc.) acts as an internal API for queries. Services never hit Sequelize directly; they request data through repositories so that caching, eager-loading, and auditing are centralized.

## 5. Notification Agents

### 5.1 Firebase Service (`src/Services/firebase`)
- Pushes FCM notifications for drivers and admins using `firebase-admin` credentials from `firebaseAccount.json`.
- Works with `NotificationController` to broadcast alerts triggered by HTTP calls or background jobs.

### 5.2 WhatsApp Notification Service
- Reuses the WhatsApp client agent but exposes helper methods (see `WpNotificationRepository` and `Services/whatsapp`) that translate domain events into WhatsApp templates or plain text.

## 6. Internationalization Layer

- Locale assets live under `src/Locales` with `locale.js` wiring the `i18n` module.
- `Locale.getInstance()` is invoked at bootstrap so every agent can call translation helpers without reconfiguration.

## 7. Operational Checklist

1. **Bootstrap**: `npm run build` followed by `npm run serve` (or PM2 using `ecosystem.config.example.js`). Ensure environment variables, Firebase credentials, and SSL certs (`src/Helpers/SSL.ts`) are available.
2. **Monitoring**: Sentry DSN configured; check Socket.IO logs for WhatsApp reconnect loops.
3. **Scaling WhatsApp Clients**: Add rows through the admin panel or seeders; the `Store` hot-reloads clients and `app.ts` instantiates a `WhatsAppClient` per tenant.
4. **Queue Health**: Inspect BullMQ dashboard (if configured) or Redis metrics, especially before marketing campaigns.
5. **Backups**: Keep current dumps of PostgreSQL (migrations + data) and Firebase service accounts. Rotate SSL certificates referenced in `config.APP_DOMAIN`.

## 8. Adding a New Agent

1. Define the responsibility and data flow (HTTP, queue, cron, or helper).
2. Create a service module under `src/Services/<agent>` with clear interfaces.
3. Register any scheduled tasks in `src/Jobs/Schedule.ts` and expose configuration through `Store` if tenant-specific.
4. Update this `agents.md` file outlining the new agent’s trigger, dependencies, and failure modes.

Keeping agents loosely coupled (controllers → services → repositories) makes migrations, scaling, and debugging significantly easier. Always document how new agents are started, monitored, and stopped so the on-call team can respond quickly.
