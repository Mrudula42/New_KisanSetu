USE kisansetu;

INSERT INTO procurement_centres (
  name,
  location,
  operating_days,
  opening_time,
  closing_time,
  slot_duration_minutes,
  max_farmers_day,
  max_quantity_kg_day,
  max_farmers_slot,
  max_quantity_kg_slot,
  emergency_reserved_kg,
  emergency_max_farmers_day
)
VALUES
  (
    'Pune Agriculture Market',
    'Market Yard, Gultekdi, Pune',
    JSON_ARRAY('Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'),
    '08:00:00',
    '17:00:00',
    30,
    100,
    20000,
    10,
    2500,
    2000,
    10
  ),
  (
    'Hadapsar Procurement Centre',
    'Hadapsar, Pune',
    JSON_ARRAY('Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'),
    '08:30:00',
    '16:30:00',
    30,
    80,
    15000,
    8,
    2000,
    1500,
    8
  ),
  (
    'Baramati Farmer Centre',
    'Baramati, Pune District',
    JSON_ARRAY('Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'),
    '08:00:00',
    '17:00:00',
    45,
    120,
    25000,
    12,
    3000,
    2500,
    12
  )
ON DUPLICATE KEY UPDATE name = VALUES(name);
