# KisanSetu

Smart agricultural procurement management for farmers and procurement-centre staff.

## Features

- Farmer profiles and crop records with kg and quintal inputs (1 quintal = 100 kg internally).
- Persistent PostgreSQL storage for farmer profiles, produce, centres, bookings, unique digital tokens, queue state, quality, procurement, payment, notifications and audit events.
- Capacity-aware time slots, configured opening days/hours, daily and slot limits for both farmer counts and kilograms.
- Eligible emergency requests with a reserved share of real centre capacity.
- Check-in/cancellation, queue estimates, quality grades and remarks, procurement status, payment references and farmer notifications.
- Staff-only operations console at /admin, with queue management, centre settings and daily analytics.
- English, Hindi and Marathi language resource files; AM/PM time presentation.
- Live queue and booking changes through Hatchable event channels.

## Hosting adaptation

This application is hosted on Hatchable. Its persistent database is PostgreSQL, and it uses Hatchable's platform-managed email-code/passkey authentication. It cannot run an npm build pipeline, a conventional Express/MySQL service, or a Python process inside this hosting runtime. Therefore the hosted implementation uses file-routed API functions and the fallback wait-time estimator. The wait-time API can call an externally hosted service configured through AI_SERVICE_URL; without that setting it keeps working using a queue-based estimate. Firebase push is not configured; in-app notifications remain persistent in the database.

## Use

1. Open the app and sign in as a farmer with your email.
2. Complete My profile.
3. Add produce and select kg or quintal.
4. Choose a centre/date and an available slot.
5. Track your token, queue position, quality/procurement status and payment.
6. Authorized Hatchable project administrators open /admin.

Admin API and page access are server-gated. To give farmers access to the live signup page, change the project's visibility from personal to public in Hatchable Settings. This is an owner-controlled console setting.

See /docs/architecture.md and /docs/database.md for implementation notes.