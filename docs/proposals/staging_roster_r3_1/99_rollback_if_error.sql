-- Run this ALONE after any error in steps 2, 3 or 5. Harmless if no transaction is open
-- (you may see "there is no transaction in progress"). It never undoes a COMMITTED migration.
ROLLBACK;
