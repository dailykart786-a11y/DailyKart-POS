-- Add image URL column to products table for product images
ALTER TABLE public.products 
ADD COLUMN IF NOT EXISTS image_url TEXT;