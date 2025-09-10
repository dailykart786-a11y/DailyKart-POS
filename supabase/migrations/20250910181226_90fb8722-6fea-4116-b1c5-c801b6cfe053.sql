-- Fix low stock detection by creating a better query approach
-- Create a view for low stock products for better performance
CREATE OR REPLACE VIEW low_stock_products AS
SELECT *
FROM products 
WHERE stock_quantity IS NOT NULL 
  AND min_stock_level IS NOT NULL 
  AND stock_quantity <= min_stock_level
  AND is_active = true;