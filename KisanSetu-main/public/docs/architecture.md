# KisanSetu architecture

Browser UI (React/htm) → Hatchable file-routed API → persistent PostgreSQL. The browser does not connect to the database directly.

## Access

Farmer API handlers declare user access and use the authenticated req.user identity to scope produce, bookings, profiles, notifications and mutations. Admin pages and APIs declare admin access so Hatchable blocks non-staff requests before the handler. UI-only route checks are not relied on for authorization.

## Booking flow

1. Farmer stores crop data; quantities are saved both in the chosen unit and normalized kilograms.
2. Slot endpoint calculates time windows from centre hours and duration, then checks farmer and quantity capacity.
3. Booking endpoint verifies ownership, centre schedule, slot alignment, emergency eligibility and existing active bookings.
4. A database transaction locks the centre and conditionally inserts only when capacity checks still pass. The insert creates the digital token.
5. Notifications and audit events are persisted, then user-scoped events trigger clients to refetch server state.
6. Staff updates queue, quality, procurement or payment fields in the same booking record and records a notification.

## Capacity rules

Daily and per-slot limits apply to both headcount and kg. Emergency kg are a reserved subset of the daily kg limit. Completed bookings consume same-day capacity; cancelled and no-show records do not. A partial unique index blocks more than one active booking per farmer and date.

## Hosting note

Hatchable runs isolate-based APIs, not a conventional Node/Express server or Python daemon. PostgreSQL and platform-managed email-code/passkey auth are used instead of MySQL and custom JWT/bcrypt. An external regression model may be configured via AI_SERVICE_URL; the fallback estimator keeps the queue usable when unavailable. Firebase push is not configured, so stored in-app notifications remain the notification source of truth.