-- =====================================================================
-- DailyKart: WhatsApp number for the daily summary
--
-- Safe to run more than once. Only ADDS things.
-- =====================================================================

-- The owner's WhatsApp number the end-of-day summary is sent to
alter table public.locations add column if not exists summary_whatsapp text;

notify pgrst, 'reload schema';
