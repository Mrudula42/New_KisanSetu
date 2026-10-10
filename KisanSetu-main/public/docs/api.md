# KisanSetu API overview

Farmer/user access is required for farmer routes; admin routes require authorized Hatchable project staff.

- GET /api/centres — active centres and today load.
- GET, POST /api/profile — read or save the signed-in farmer profile.
- GET, POST /api/produce — list or add farmer-owned produce.
- GET /api/slots?centre_id=ID&date=YYYY-MM-DD&quantity_kg=N — see daily slots and capacity.
- GET, POST /api/bookings — list the farmer's booking history or submit a regular/emergency booking.
- POST /api/booking-action — check in or cancel an eligible booking.
- GET, PATCH /api/notifications — list notifications or mark a recipient's notification as read.
- GET /api/ai/waiting-time?booking_id=ID — queue-based wait estimate, with optional configured AI endpoint.
- GET, PATCH /api/admin/board — staff metrics/bookings or update queue, quality, procurement and payment.
- POST, PATCH /api/admin/centres — staff create or edit centre capacity and settings.
- GET /api/events-token — issue the authenticated farmer's private realtime token.
- GET /api/admin/events-token — issue an admin-only realtime token.

Protected endpoints validate identities and record ownership on the server. User-facing responses use non-technical validation errors.