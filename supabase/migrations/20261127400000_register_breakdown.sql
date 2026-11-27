-- =====================================================================
-- DailyKart: day closing by notes, coins and online payments
--   * register_sessions.opening_breakdown / closing_breakdown (jsonb):
--     how many of each note and coin were counted, and (at closing) the
--     UPI, card and other online amounts the shop actually received.
--   * open_register_v2(cash, breakdown) and close_register_v2(cash, note,
--     breakdown) wrap the existing open_register / close_register, so the
--     cash maths stays in one place. The old functions keep working.
--   * Closing also stores expected vs counted for every payment method.
-- Only adds. Safe to run more than once.
-- =====================================================================

alter table public.register_sessions add column if not exists opening_breakdown jsonb;
alter table public.register_sessions add column if not exists closing_breakdown jsonb;

create or replace function public.open_register_v2(p_opening_cash numeric default 0, p_breakdown jsonb default null)
returns public.register_sessions
language plpgsql security definer set search_path = public as $$
declare
  v_row public.register_sessions;
begin
  if p_breakdown is not null and jsonb_typeof(p_breakdown) <> 'object' then
    raise exception 'Breakdown must be an object';
  end if;
  v_row := public.open_register(p_opening_cash);
  if p_breakdown is not null then
    update public.register_sessions set opening_breakdown = p_breakdown
    where id = v_row.id and user_id = auth.uid() and closed_at is null
    returning * into v_row;
  end if;
  return v_row;
end;
$$;

create or replace function public.close_register_v2(p_counted_cash numeric, p_note text default null, p_breakdown jsonb default null)
returns public.register_sessions
language plpgsql security definer set search_path = public as $$
declare
  v_row public.register_sessions;
  v_t jsonb;
  v_b jsonb := coalesce(p_breakdown, '{}'::jsonb);
  v_upi numeric; v_card numeric; v_other numeric;
  v_exp_upi numeric; v_exp_card numeric; v_exp_other numeric;
begin
  if jsonb_typeof(v_b) <> 'object' then raise exception 'Breakdown must be an object'; end if;
  v_row := public.close_register(p_counted_cash, p_note);
  v_t := coalesce(v_row.totals, '{}'::jsonb);

  v_exp_upi   := coalesce((v_t->>'upi_sales')::numeric, 0) + coalesce((v_t->>'khata_upi_received')::numeric, 0);
  v_exp_card  := coalesce((v_t->>'card_sales')::numeric, 0);
  v_exp_other := coalesce((v_t->>'bank_sales')::numeric, 0);
  v_upi   := nullif(v_b->>'upi', '')::numeric;
  v_card  := nullif(v_b->>'card', '')::numeric;
  v_other := nullif(v_b->>'other', '')::numeric;
  if coalesce(v_upi, 0) < 0 or coalesce(v_card, 0) < 0 or coalesce(v_other, 0) < 0 then
    raise exception 'Amounts cannot be negative';
  end if;

  update public.register_sessions
  set closing_breakdown = v_b || jsonb_build_object(
    'methods', jsonb_build_object(
      'cash',  jsonb_build_object('expected', v_row.expected_cash, 'counted', v_row.counted_cash, 'difference', v_row.difference),
      'upi',   jsonb_build_object('expected', round(v_exp_upi, 2), 'counted', v_upi,
                                  'difference', case when v_upi is null then null else round(v_upi - v_exp_upi, 2) end),
      'card',  jsonb_build_object('expected', round(v_exp_card, 2), 'counted', v_card,
                                  'difference', case when v_card is null then null else round(v_card - v_exp_card, 2) end),
      'other', jsonb_build_object('expected', round(v_exp_other, 2), 'counted', v_other,
                                  'difference', case when v_other is null then null else round(v_other - v_exp_other, 2) end)
    ))
  where id = v_row.id
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.open_register_v2(numeric, jsonb) from public, anon;
revoke all on function public.close_register_v2(numeric, text, jsonb) from public, anon;
grant execute on function public.open_register_v2(numeric, jsonb) to authenticated;
grant execute on function public.close_register_v2(numeric, text, jsonb) to authenticated;

notify pgrst, 'reload schema';
