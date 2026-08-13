# Gorda API Service release notes

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Fix a race in new-session registration that made the first message of any brand-new chat session fail the conversation turn (`Cannot read properties of undefined (reading 'created_at')`), plus a defensive guard in the conversation-turn processor that logs and discards a turn instead of crashing if it ever finds the in-memory session desynced from the database.
- Fixed chatbot outbound messages being stamped with millisecond timestamps, causing out-of-order message display and incorrect date separators in the admin chat.
- Fix duplicate chatbot replies on Official (Meta Cloud API) lines caused by accumulated singleton event listeners across `destroy`/`recreate` cycles and cross-session message re-parenting: `WPClientInterface` implementations now expose `removeAllListeners()`, called before re-registering wrapper events on client init, and `SessionRepository.addMsg` no longer re-parents a message row that already exists under a different chat session (it now returns `{created: false}` without mutating the row or downgrading `processed`).

## [2.0.13(2026-08-11)](https://github.com/DevAlexandreCR/gorda-api/compare/2.0.13...2.0.12)

### Added

- Persist bot replies to `whatsapp_messages` (`fromMe: true`, marked processed) so conversation history includes both sides of the chat; persistence failure is logged and never blocks sending the reply.
- Replace the chatbot's in-memory message buffering with a sliding-window debounce backed by delayed BullMQ jobs (one conversation-turn job per inbound message, on a per-WpClient queue, concurrency 1, survives process restarts): the bot now replies after the customer's *last* message instead of a fixed window from their first. Stale turns (a newer message arrived, or the session reached `COMPLETED`/`SUPPORT`) are discarded silently, before the AI call when possible and before any send or service-creation side effect otherwise, with no error-fallback message sent to the customer. New env var `CHATBOT_DEBOUNCE_MS` (default 5000) configures the debounce window. **Behavior change:** interactive button replies now process immediately instead of being buffered with text.
- Show a read receipt and "typing…" indicator to the customer on the Official (Meta Cloud API) transport while a debounce window and AI processing run; no-op on Baileys/WWebClient.
- Emit a structured per-turn outcome log (`completed | superseded_pre_ai | discarded_post_ai | error`) for the new conversation-turn processor.

### Changed

- Chatbot place resolution now auto-accepts a "strong candidate" search result — a dominant top score, or a sole full-coverage keyword match — instead of always asking for confirmation on non-literal matches; ambiguous results still go through the existing confirmation/suggestion flow. Keyword search scoring is now coverage-sensitive (score reflects the fraction of the query's keywords matched), so partial coincidental matches can no longer reach the auto-accept threshold.
- **Breaking (`ia-app` request contract):** AI requests now carry full session context instead of a bare message and status — the real session status (including `CREATED`, previously hardcoded to `ASKING_FOR_PLACE`), known data (client name, session place), and the last 10 conversation turns from both directions. Deploy together with the matching `ia-app` release.
- The AI response now carries a required `intent` classification (`PROVIDE_NAME`, `PROVIDE_PLACE`, `SUPPORT`, `REFUSAL`, `AMBIGUOUS`); the `Created`, `AskingForName`, and `AskingForPlace` chatbot strategies branch on it instead of only inspecting the extracted `place`/`session_status`. Name and place provided in a single message during name capture are both captured now — the place flow runs immediately instead of re-asking for the location.

### Fixed

- Fix SUPPORT messages that mention a place (e.g. "¿cuánto cuesta un viaje desde La Esmeralda?") being misread as a ride request — SUPPORT classification now takes precedence over an extracted `place` in the `AskingForPlace` and `Created` strategies.

- Fix production `.env` being silently ignored: `config.js` resolved it against the compiled `build/` directory (via `__dirname`), which never receives a copy of `.env`. Config now loads `.env` from the process working directory, and the PM2 ecosystem example drops its duplicated `env` block in favor of setting `cwd` so the app's own `.env` load is authoritative.

## [2.0.12(2026-08-01)](https://github.com/DevAlexandreCR/gorda-api/compare/2.0.12...2.0.11)

### Added

- Add an authenticated heartbeat endpoint `PUT /driver-app/me/location` that refreshes `location` and `last_seen_at` on `online_drivers/{id}` via an RTDB transaction: aborts with `410 not_connected` without ever recreating a removed presence node, and aborts with `409 session_superseded` to protect a newer session from being overwritten by a stale one.
- Add an optional `PRESENCE_SWEEP_INTERVAL_MS` env var (default 60000) driving the stale-presence sweep interval, decoupled from `DISCONNECT_TIMEOUT`.
- Add `directed_to` to the RTDB service interface and an `ORIGIN_TEST` constant for directed test services.
- Add `POST /driver-app/me/services`, letting a connected driver create a metered "self-service" trip (`origin='driver'`): online mode enforces eligibility (connected, enabled, monthly-or-positive-balance, not already busy) with typed rejection reasons; a `deferred: true` mode accepts app-reported timestamps and terminal data for trips completed offline, applying the terminal status as a second write so settlement and history triggers fire.
- Add `POST /driver-app/me/services/:id/cancel` for windowed driver cancellation of self-service trips, backed by a new `self_service_cancel_window` ride-fee setting (default 120s) delivered via the ride-fees snapshot.
- Add a `driver` ("Conductor") bucket to the billing service-source summary, excluded from the `admin`/`bot` buckets.
- Add an `origin` query param to `GET /services/history`.

### Changed

- Exclude `origin = 'test'` history rows from the `service_metrics_daily` rebuild (both `rebuildMetricsForDate` and `rebuildAllMetrics`), using a NULL-safe predicate, so directed test services no longer inflate operational counts or commission revenue.
- Exclude `origin = 'driver'` services from client-scoped completed-service counts.

### Fixed

- Fix stale-presence eviction in `RemoveConnectedDrivers`, which never fired due to a milliseconds-vs-seconds units mismatch between `last_seen_at` and the configured threshold. Eviction is now silent (no force-disconnect FCM push), releases the driver's vehicle assignment, and is immune to phantom staleness via a tracker purge on node removal plus a remove-if-stale RTDB transaction safe under concurrent sweeps.
- Fix self-service creation not upserting the `clients` row for the driver-derived `client_id`, which caused an FK violation when finalizing `service_history`.

## [2.0.11(2026-07-08)](https://github.com/DevAlexandreCR/gorda-api/compare/2.0.11...2.0.10)

### Added

- Add `GET /metrics/revenue` returning per-month commission earned, active monthly-fee income (excluding voided), paying-driver counts, and recharge totals.
- Add a `commission_sum` rollup column to `service_metrics_daily`, incrementally maintained on finalize and backfilled via `rebuildAllMetrics()`, so revenue reads never scan `service_history`.
- Expose a monthly frequency for the top-drivers metric.

## [2.0.10(2026-07-05)](https://github.com/DevAlexandreCR/gorda-api/compare/2.0.10...2.0.9)

### Added

- Support payment filtering on the drivers list (`GET /drivers`): filter by `paymentMode` (monthly/percentage) and by `paymentStatus` (paid/pending) for a given `period` (`YYYY-MM`, defaulting to the current Bogota period), joining active monthly payments to resolve paid/pending status.
- Add a route integrity audit endpoint (`GET /services/route-integrity`) that aggregates per-driver metrics (total trips, flagged trips, flagged ratio) over a date range, plus a `routeIntegrity=flagged` filter on `GET /services/history`. A single canonical rule flags terminated trips that went through the trip flow but have no usable route capture or a non-positive trip distance.

### Added

- Add an authenticated endpoint to void a driver monthly payment (`POST /drivers/:id/monthly-payments/:paymentId/void`) that soft-voids the record — recording status, reason, actor, and timestamp — without deleting it, preserving the audit trail.

### Changed

- Redefine "paid for a period" to count only active (non-voided) monthly payments, so a voided payment no longer counts as paid in the monthly payment reminder and auto-disable jobs or the manual re-enable gate.

## [2.0.8(2026-07-01)](https://github.com/DevAlexandreCR/gorda-api/compare/2.0.8...2.0.7)

### Added

- Persist the per-service driver deduction in a new `service_history.deducted_value` column (set from `metadata.discount` on finalize) and expose it on `GET /services/history`.

## [2.0.7(2026-06-30)](https://github.com/DevAlexandreCR/gorda-api/compare/2.0.7...2.0.6)

### Added

- Resolve and expose the per-service vehicle (`{ plate, brand, model, color }`) on the services history endpoint from the persisted `vehicle_id`, batching the lookup to avoid N+1.

### Fixed

- Include the resolved `selected_vehicle` in the unparameterized drivers list (`GET /drivers`) so consumers receive the driver's currently selected vehicle, not just its id.

## [2.0.6(2026-06-25)](https://github.com/DevAlexandreCR/gorda-api/compare/2.0.6...2.0.5)

### Added

- Add driver monthly payment domain: settings and payment records (models, migrations, repositories) with monthly payment validation when enabling drivers.
- Add scheduled jobs to send monthly payment reminders and disable drivers with unpaid monthly payments.
- Add a Bogota timezone helper service.

## [2.0.5(2026-06-12)](https://github.com/DevAlexandreCR/gorda-api/compare/2.0.5...2.0.4)

### Added

- Add normalized vehicle table migration, roster linking flow, and connect endpoint support for drivers. [#115](https://github.com/DevAlexandreCR/gorda-api/pull/115)

### Changed

- Tighten vehicle completeness validation and lookup response handling for the extracted vehicles flow. [#115](https://github.com/DevAlexandreCR/gorda-api/pull/115)

## [2.0.4(2026-06-08)](https://github.com/DevAlexandreCR/gorda-api/compare/2.0.4...2.0.3)

### Added

- Expose client completed services count through the services API and service creation flow.
- Add driver list filtering, sorting, pagination, and bulk enable/disable plus push notification endpoints.

### Changed

- Document Docker Compose local environment values in .env.example.

# Release Notes for 2.0.x

## [2.0.3(2026-04-14)](https://github.com/DevAlexandreCR/gorda-api/compare/2.0.3...2.0.2)

### Changed

- Improve conexion and balance

## [2.0.2(2026-04-14)](https://github.com/DevAlexandreCR/gorda-api/compare/2.0.2...2.0.1)

### Changed

- Improve performance of the app with SQL database

## [2.0.0(2026-04-14)](https://github.com/DevAlexandreCR/gorda-api/compare/2.0.0...1.6.2)

### Added

- Change firestore by SQL database

# Release Notes for 1.6.x

## [1.6.2 (2025-11-29)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.6.2...v1.6.1)

### Changed

- change db clients to postgres [#112](https://github.com/DevAlexandreCR/gorda-api/pull/112)


## [1.6.1 (2025-10-18)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.6.1...v1.6.0)

### Added

- full mode support. [#109](https://github.com/DevAlexandreCR/gorda-api/pull/109)

## [1.6.0 (2025-10-05)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.6.0...v1.5.4)

### Added

- Add postgres connection with Sequelize. [#106](https://github.com/DevAlexandreCR/gorda-api/pull/106)

# Release Notes for 1.5.x

## [1.5.4 (2025-07-09)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.5.4...v1.5.3)

### Added

- Add dynamic multiplier update. [#102](https://github.com/DevAlexandreCR/gorda-api/pull/102)

## [1.5.3 (2025-05-27)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.5.3...v1.5.2)

### Added

- Add support to interactive messages. [#100](https://github.com/DevAlexandreCR/gorda-api/pull/100)
- Add support to notifications. [#101](https://github.com/DevAlexandreCR/gorda-api/pull/101)

## [1.5.2 (2025-03-03)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.5.2...v1.5.1)

### Added

- Add queue jobs to send messages. [#98](https://github.com/DevAlexandreCR/gorda-api/pull/98)

## [1.5.1 (2024-12-02)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.5.1...v1.5.1)

### Added

- Cron to set dynamic min fee.

## [1.5.0 (2024-11-30)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.5.0...v1.4.5)

### Added

- Add get city from location. ([#96](https://github.com/DevAlexandreCR/gorda-api/pull/96)

# Release Notes for 1.4.x

## [1.4.5 (2024-10-30)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.4.5...v1.4.4)

### Added

- Add location button to interactive message. ([#94](https://github.com/DevAlexandreCR/gorda-api/pull/94)

## [1.4.4 (2024-10-14)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.4.4...v1.4.3)

### Added

- Restart button from frontend. ([#92](https://github.com/DevAlexandreCR/gorda-api/pull/92))

## [1.4.3 (2024-09-15)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.4.3...v1.4.2)

### Fixed

- Fix errors on connection Baileys. ([#90](https://github.com/DevAlexandreCR/gorda-api/pull/90))

## [1.4.2 (2024-09-12)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.4.2...v1.4.1)

### Added

- Implement Baileys ans fix errors. ([#90](https://github.com/DevAlexandreCR/gorda-api/pull/90))

## [1.4.1 (2024-09-04)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.4.1...v1.4.0)

### Fixed

- Location Messages in chatbot. ([#88](https://github.com/DevAlexandreCR/gorda-api/pull/88))

## [1.4.0 (2024-07-23)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.4.0...v1.3.7)

### Added

- New Whatsapp Api connection. ([#86](https://github.com/DevAlexandreCR/gorda-api/pull/86))

# Release Notes for 1.3.x

## [1.3.7 (2024-05-14)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.3.7...v1.3.6)

### Fixed

-   Restart chromium on exit ([#84](https://github.com/DevAlexandreCR/gorda-api/pull/84))

## [1.3.6 (2024-05-14)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.3.6...v1.3.5)

### Fixed

-   Overwritten messages ([#82](https://github.com/DevAlexandreCR/gorda-api/pull/82))

## [1.3.5 (2024-05-13)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.3.5...v1.3.4)

### Added

-   Get Messages from DB ([#80](https://github.com/DevAlexandreCR/gorda-api/pull/80))

## [1.3.4 (2024-04-03)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.3.4...v1.3.3)

### Fixed

-   Add wweb version from remote ([#79](https://github.com/DevAlexandreCR/gorda-api/pull/79))

## [1.3.3 (2024-03-23)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.3.3...v1.3.2)

### Fixed

-   Message unsupported ([#77](https://github.com/DevAlexandreCR/gorda-api/pull/77))

## [1.3.2 (2024-03-20)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.3.2...v1.3.1)

### Fixed

-   Send completed when assistant enabled ([#74](https://github.com/DevAlexandreCR/gorda-api/pull/74))

## [1.3.1 (2024-03-20)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.3.1...v1.3.0)

### Fixed

-   node-fetch not found huggingface ([#73](https://github.com/DevAlexandreCR/gorda-api/pull/73))

## [1.3.0 (2024-03-19)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.3.0...v1.2.1)

### Added

-   Added ChatBot and assistant ([#70](https://github.com/DevAlexandreCR/gorda-api/pull/70))

# Release Notes for 1.2.x

## [1.2.1 (2024-02-26)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.2.1...v1.2.0)

### Changed

-   Change messages new service. [#68](https://github.com/DevAlexandreCR/gorda-api/pull/68)

## [1.2.0 (2024-02-03)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.2.0...v1.1.18)

### Added

-   A Client can use mor than 1 wpClient. [#66](https://github.com/DevAlexandreCR/gorda-api/pull/66)

# Release Notes for 1.1.x

## [1.1.21 (2023-12-16)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.1.21...v1.1.20)

### Changed

-   Change new service message. [#64](https://github.com/DevAlexandreCR/gorda-api/pull/64)

## [1.1.20 (2023-12-08)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.1.20...v1.1.19)

### Changed

-   Change assigned message. [#62](https://github.com/DevAlexandreCR/gorda-api/pull/62)

## [1.1.19 (2023-08-09)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.1.19...v1.1.18)

### Fixed

-   Fixed promise was collected. [#61](https://github.com/DevAlexandreCR/gorda-api/pull/61)

## [1.1.18 (2023-08-09)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.1.18...v1.1.17)

### Fixed

-   Fixed send messages. [#59](https://github.com/DevAlexandreCR/gorda-api/pull/59)

## [1.1.17 (2023-08-09)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.1.17...v1.1.16)

### Fixed

-   Upgrade version of wp-webjs. [#57](https://github.com/DevAlexandreCR/gorda-api/pull/57)

## [1.1.16 (2023-07-11)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.1.16...v1.1.15)

### Added

-   Add cron to populate metrics. [#55](https://github.com/DevAlexandreCR/gorda-api/pull/55)

## [1.1.15 (2023-07-10)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.1.15...v1.1.14)

### Added

-   Add cron to remove inactive drivers. [#52](https://github.com/DevAlexandreCR/gorda-api/pull/52)

## [1.1.14 (2023-05-20)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.1.14...v1.1.13)

### Changed

-   Update wp web. [#50](https://github.com/DevAlexandreCR/gorda-api/pull/50)

## [1.1.13 (2023-05-13)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.1.13...v1.1.12)

### Changed

-   Remove prices from messages.
-   Add ask for cancel message. [#48](https://github.com/DevAlexandreCR/gorda-api/pull/48)

## [1.1.11 (2023-04-24)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.1.11...v1.1.10)

### Changed

-   Remove keep alive. [#46](https://github.com/DevAlexandreCR/gorda-api/pull/46)

## [1.1.10 (2023-03-27)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.1.10...v1.1.8)

### Added

-   Save received messages. [#44](https://github.com/DevAlexandreCR/gorda-api/pull/44)

## [1.1.8 (2023-03-15)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.1.8...v1.1.7)

### Fixed

-   Add onLoading screen. [#40](https://github.com/DevAlexandreCR/gorda-api/pull/40)

## [1.1.6 (2023-03-08)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.1.6...v1.1.5)

### Fixed

-   Fixed interval 5min. [#37](https://github.com/DevAlexandreCR/gorda-api/pull/37)

## [1.1.5 (2023-03-08)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.1.5...v1.1.1)

### Added

-   Add new Service notification. [#33](https://github.com/DevAlexandreCR/gorda-api/pull/35)

## [1.1.1 (2023-02-28)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.0.7...v1.1.1)

### Changed

-   Add exit after crash. [#33](https://github.com/DevAlexandreCR/gorda-api/pull/33)

# Release Notes for 1.0.x

## [1.0.7 (2023-01-08)](https://github.com/DevAlexandreCR/gorda-api/compare/v1.0.6...v1.0.7)

### Changed

-   update node dependencies [#26](https://github.com/DevAlexandreCR/gorda-api/pull/26)
