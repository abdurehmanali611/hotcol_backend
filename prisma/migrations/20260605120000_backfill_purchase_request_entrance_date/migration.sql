-- Historical rows: entrance date = day the purchase line was first saved (createdAt).
UPDATE `PurchaseRequest`
SET `entranceDate` = `createdAt`;
