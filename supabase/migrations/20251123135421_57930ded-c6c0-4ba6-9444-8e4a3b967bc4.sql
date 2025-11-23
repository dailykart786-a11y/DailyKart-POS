-- Add old and new purchase price columns for price tracking
ALTER TABLE products
ADD COLUMN old_purchase_price NUMERIC(10,2),
ADD COLUMN new_purchase_price NUMERIC(10,2),
ADD COLUMN base_unit TEXT DEFAULT 'pc',
ADD COLUMN base_unit_quantity NUMERIC(10,2) DEFAULT 1,
ADD COLUMN unit_variants JSONB DEFAULT '[]'::jsonb;

-- Add comments for documentation
COMMENT ON COLUMN products.old_purchase_price IS 'Previous purchase price for comparison';
COMMENT ON COLUMN products.new_purchase_price IS 'Current/latest purchase price';
COMMENT ON COLUMN products.base_unit IS 'Base unit of measurement: gm, kg, ltr, ml, pc';
COMMENT ON COLUMN products.base_unit_quantity IS 'Quantity for the base unit price (e.g., 1000 for 1kg if base is gm)';
COMMENT ON COLUMN products.unit_variants IS 'Array of unit variants with quantities and prices: [{"unit":"10gm","quantity":10,"price":5.00}]';