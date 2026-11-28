-- Remove the view and replace with a simple function approach
DROP VIEW IF EXISTS low_stock_products;

-- Create a security definer function to get low stock products
CREATE OR REPLACE FUNCTION get_low_stock_products()
RETURNS TABLE (
  id uuid,
  name text,
  sku text,
  barcode text,
  category text,
  price numeric,
  cost_price numeric,
  stock_quantity integer,
  min_stock_level integer,
  gst_rate numeric,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz,
  location_id uuid,
  image_url text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM products 
  WHERE stock_quantity IS NOT NULL 
    AND min_stock_level IS NOT NULL 
    AND stock_quantity <= min_stock_level
    AND is_active = true;
$$;