# KisanSetu database notes

Migration: migrations/0001_kisansetu_schema.sql. It runs automatically on first deploy.

## Main tables

- farmer_profiles: farmer name, phone, village, district and language keyed to the authenticated app user.
- farmer_produce: crop, entered quantity and unit, normalized quantity_kg, harvest date, perishability, urgency and notes.
- procurement_centres: location, operating days/hours, slot length, daily and slot farmer limits, daily and slot kg limits, emergency reservation and queue priority setting.
- bookings: farmer/produce/centre relationship, procurement date and slot, quantity, unique token, emergency flag, queue status, quality result, procurement status and payment status/details.
- notifications: recipient-specific messages and read state.
- booking_events: status/action audit history.

## Quantity conversion

For unit kg, quantity_kg equals quantity. For unit quintal, quantity_kg equals quantity multiplied by 100. Capacity calculations use quantity_kg.

## Constraints

The schema includes positive quantity/capacity checks, status and unit checks, centre operating-hour validation, unique tokens, relationships to produce and centres, query indexes, and a partial unique index for one active farmer booking per date.

Migrations are forward-only after deployment. Add a new numbered migration for later schema changes rather than editing an already applied migration.