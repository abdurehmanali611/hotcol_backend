-- Drop unused inventory fields: duty fee and supplier tier.
ALTER TABLE `ItemRegistration` DROP COLUMN `dutyFee`;
ALTER TABLE `ItemRegistration` DROP COLUMN `supplierLevel`;
ALTER TABLE `ItemStatus` DROP COLUMN `supplierLevel`;
