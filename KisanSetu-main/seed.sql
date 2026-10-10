INSERT INTO procurement_centres (name, location, operating_days, opening_time, closing_time, slot_duration_minutes, max_farmers_day, max_quantity_kg_day, max_farmers_slot, max_quantity_kg_slot, emergency_reserved_kg, emergency_max_farmers_day)
SELECT 'Pune Agriculture Market', 'Market Yard, Gultekdi, Pune', ARRAY['Mon','Tue','Wed','Thu','Fri','Sat'], '08:00', '17:00', 30, 100, 20000, 10, 2500, 2000, 10
WHERE NOT EXISTS (SELECT 1 FROM procurement_centres WHERE name = 'Pune Agriculture Market');

INSERT INTO procurement_centres (name, location, operating_days, opening_time, closing_time, slot_duration_minutes, max_farmers_day, max_quantity_kg_day, max_farmers_slot, max_quantity_kg_slot, emergency_reserved_kg, emergency_max_farmers_day)
SELECT 'Hadapsar Procurement Centre', 'Hadapsar, Pune', ARRAY['Mon','Tue','Wed','Thu','Fri','Sat'], '08:30', '16:30', 30, 80, 15000, 8, 2000, 1500, 8
WHERE NOT EXISTS (SELECT 1 FROM procurement_centres WHERE name = 'Hadapsar Procurement Centre');

INSERT INTO procurement_centres (name, location, operating_days, opening_time, closing_time, slot_duration_minutes, max_farmers_day, max_quantity_kg_day, max_farmers_slot, max_quantity_kg_slot, emergency_reserved_kg, emergency_max_farmers_day)
SELECT 'Baramati Farmer Centre', 'Baramati, Pune District', ARRAY['Mon','Tue','Wed','Thu','Fri','Sat'], '08:00', '17:00', 45, 120, 25000, 12, 3000, 2500, 12
WHERE NOT EXISTS (SELECT 1 FROM procurement_centres WHERE name = 'Baramati Farmer Centre');