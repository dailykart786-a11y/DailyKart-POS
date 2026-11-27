-- =====================================================================
-- DailyKart: staff, attendance, shifts, advances, salary and commission
--   * staff list (with or without an app login), shift times, weekly off
--   * daily attendance (present, half day, absent, paid leave) marked by
--     the manager, or clock in / clock out by the staff member themself
--   * late marks against the shift start
--   * salary advances and monthly salary: earned pay + sales commission
--     + bonus - deductions - advances. Advances and salary are saved as
--     "Salary" expenses, so the till, expenses, P&L and books all match.
-- New permission "staff" (manager gets it once by default).
-- Only adds things. Safe to run more than once.
-- =====================================================================

-- one-time seeds (so re-running never undoes the owner's later changes)
create table if not exists public.schema_once (key text primary key, done_at timestamptz not null default now());
alter table public.schema_once enable row level security;

do $$ begin
  if not exists (select 1 from public.schema_once where key = 'perm_staff_manager') then
    insert into public.role_permissions (role, permission) values ('manager', 'staff') on conflict do nothing;
    insert into public.schema_once (key) values ('perm_staff_manager');
  end if;
end $$;

create table if not exists public.staff (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete restrict,
  name text not null check (length(trim(name)) > 0),
  phone text,
  job_title text,
  user_id uuid references auth.users(id) on delete set null,
  pay_type text not null default 'monthly' check (pay_type in ('monthly', 'daily')),
  salary numeric(10,2) not null default 0 check (salary >= 0),       -- monthly salary or daily wage
  commission_pct numeric(5,2) not null default 0 check (commission_pct between 0 and 100),
  shift_start time,
  shift_end time,
  weekly_off smallint check (weekly_off between 0 and 6),             -- 0 = Sunday
  joined_on date,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_staff_user on public.staff(user_id) where user_id is not null;
create index if not exists idx_staff_location on public.staff(location_id);

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete restrict,
  date date not null,
  status text not null default 'present' check (status in ('present', 'half_day', 'absent', 'paid_leave')),
  check_in timestamptz,
  check_out timestamptz,
  late_minutes integer not null default 0 check (late_minutes >= 0),
  note text,
  marked_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  unique (staff_id, date)
);
create index if not exists idx_attendance_loc_date on public.attendance(location_id, date);

create table if not exists public.staff_advances (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete restrict,
  location_id uuid not null references public.locations(id) on delete restrict,
  amount numeric(10,2) not null check (amount > 0),
  given_on date not null default ((now() at time zone 'Asia/Kolkata')::date),
  expense_id uuid references public.expenses(id) on delete set null,
  payroll_id uuid,
  note text,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists idx_staff_advances_staff on public.staff_advances(staff_id);

create table if not exists public.staff_payroll (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete restrict,
  location_id uuid not null references public.locations(id) on delete restrict,
  month date not null check (extract(day from month) = 1),
  paid_days numeric(5,1) not null default 0,
  earned numeric(10,2) not null default 0,
  commission numeric(10,2) not null default 0,
  bonus numeric(10,2) not null default 0,
  deductions numeric(10,2) not null default 0,
  advances numeric(10,2) not null default 0,
  net_paid numeric(10,2) not null default 0,
  expense_id uuid references public.expenses(id) on delete set null,
  note text,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (staff_id, month)
);

-- ---------- Access: staff permission in own store (admin everywhere); a staff member sees their own rows
alter table public.staff enable row level security;
alter table public.attendance enable row level security;
alter table public.staff_advances enable row level security;
alter table public.staff_payroll enable row level security;

create or replace function public.can_manage_staff(p_location_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.get_user_role(auth.uid()) = 'admin'
      or (public.has_perm('staff') and p_location_id = public.get_user_location(auth.uid()))
$$;
grant execute on function public.can_manage_staff(uuid) to authenticated;

drop policy if exists "read staff" on public.staff;
create policy "read staff" on public.staff for select to authenticated
  using (public.can_manage_staff(location_id) or user_id = auth.uid());
drop policy if exists "manage staff" on public.staff;
create policy "manage staff" on public.staff for all to authenticated
  using (public.can_manage_staff(location_id)) with check (public.can_manage_staff(location_id));

drop policy if exists "read attendance" on public.attendance;
create policy "read attendance" on public.attendance for select to authenticated
  using (public.can_manage_staff(location_id) or exists (select 1 from public.staff s where s.id = staff_id and s.user_id = auth.uid()));
drop policy if exists "manage attendance" on public.attendance;
create policy "manage attendance" on public.attendance for all to authenticated
  using (public.can_manage_staff(location_id)) with check (public.can_manage_staff(location_id));

drop policy if exists "read staff_advances" on public.staff_advances;
create policy "read staff_advances" on public.staff_advances for select to authenticated
  using (public.can_manage_staff(location_id) or exists (select 1 from public.staff s where s.id = staff_id and s.user_id = auth.uid()));
drop policy if exists "read staff_payroll" on public.staff_payroll;
create policy "read staff_payroll" on public.staff_payroll for select to authenticated
  using (public.can_manage_staff(location_id) or exists (select 1 from public.staff s where s.id = staff_id and s.user_id = auth.uid()));

grant select, insert, update, delete on public.staff, public.attendance to authenticated;
grant select on public.staff_advances, public.staff_payroll to authenticated;
grant all on public.staff, public.attendance, public.staff_advances, public.staff_payroll to service_role;

-- attendance rows always carry the staff member's store
create or replace function public.attendance_fill()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select location_id into new.location_id from public.staff where id = new.staff_id;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_attendance_fill on public.attendance;
create trigger trg_attendance_fill before insert or update on public.attendance
  for each row execute function public.attendance_fill();

-- ---------- Clock in / out for the signed-in staff member
create or replace function public.my_staff_today()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('staff_id', s.id, 'name', s.name, 'shift_start', s.shift_start, 'shift_end', s.shift_end,
                            'check_in', a.check_in, 'check_out', a.check_out, 'status', a.status, 'late_minutes', a.late_minutes)
  from public.staff s
  left join public.attendance a on a.staff_id = s.id and a.date = (now() at time zone 'Asia/Kolkata')::date
  where s.user_id = auth.uid() and s.is_active
$$;
grant execute on function public.my_staff_today() to authenticated;

create or replace function public.clock_in()
returns public.attendance language plpgsql security definer set search_path = public as $$
declare
  v_staff public.staff;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_now_local time := (now() at time zone 'Asia/Kolkata')::time;
  v_late integer := 0;
  v_row public.attendance;
begin
  select * into v_staff from public.staff where user_id = auth.uid() and is_active;
  if v_staff.id is null then raise exception 'You are not on the staff list. Ask the manager to link your login.'; end if;
  if v_staff.shift_start is not null and v_now_local > v_staff.shift_start + interval '10 minutes' then
    v_late := floor(extract(epoch from (v_now_local - v_staff.shift_start)) / 60);
  end if;
  insert into public.attendance (staff_id, location_id, date, status, check_in, late_minutes, marked_by)
  values (v_staff.id, v_staff.location_id, v_today, 'present', now(), v_late, auth.uid())
  on conflict (staff_id, date) do update
    set check_in = coalesce(public.attendance.check_in, excluded.check_in),
        late_minutes = case when public.attendance.check_in is null then excluded.late_minutes else public.attendance.late_minutes end,
        status = case when public.attendance.status = 'absent' then 'present' else public.attendance.status end
  returning * into v_row;
  return v_row;
end;
$$;
grant execute on function public.clock_in() to authenticated;

create or replace function public.clock_out()
returns public.attendance language plpgsql security definer set search_path = public as $$
declare
  v_row public.attendance;
begin
  update public.attendance a set check_out = now()
  from public.staff s
  where s.id = a.staff_id and s.user_id = auth.uid()
    and a.date = (now() at time zone 'Asia/Kolkata')::date and a.check_in is not null
  returning a.* into v_row;
  if v_row.id is null then raise exception 'Clock in first'; end if;
  return v_row;
end;
$$;
grant execute on function public.clock_out() to authenticated;

-- ---------- Month summary: what each person has earned
--   monthly pay: salary minus a day's pay for each absent day (half for a half day)
--   daily pay:   wage x (present + half days / 2 + paid leave)
--   commission:  % of their bills (before GST) as cashier, when linked to a login
--   advances:    given and not yet settled in a salary
create or replace function public.staff_month_summary(p_month date, p_location_id uuid default null)
returns table (staff_id uuid, name text, job_title text, pay_type text, salary numeric, commission_pct numeric,
               present numeric, half_days numeric, absent numeric, paid_leave numeric, late_days numeric, unmarked numeric,
               paid_days numeric, earned numeric, sales_total numeric, commission numeric, advances numeric,
               payable numeric, paid boolean, net_paid numeric)
language sql stable security invoker set search_path = public as $$
  with m as (
    select date_trunc('month', p_month)::date as m0,
           (date_trunc('month', p_month) + interval '1 month - 1 day')::date as m1
  ), m2 as (
    select m0, m1, extract(day from m1)::numeric as days,
           least(m1, (now() at time zone 'Asia/Kolkata')::date) as upto
    from m
  )
  select s.id, s.name, s.job_title, s.pay_type, s.salary, s.commission_pct,
         coalesce(a.present, 0), coalesce(a.half_days, 0), coalesce(a.absent, 0), coalesce(a.paid_leave, 0), coalesce(a.late_days, 0),
         greatest(0, (m2.upto - greatest(m2.m0, coalesce(s.joined_on, m2.m0)) + 1) - coalesce(a.marked, 0))::numeric as unmarked,
         x.paid_days, x.earned, coalesce(sl.total, 0), round(coalesce(sl.total, 0) * s.commission_pct / 100, 2),
         coalesce(adv.total, 0),
         round(x.earned + round(coalesce(sl.total, 0) * s.commission_pct / 100, 2) - coalesce(adv.total, 0), 2),
         p.id is not null, p.net_paid
  from public.staff s
  cross join m2
  left join lateral (
    select count(*) filter (where status = 'present')::numeric as present,
           count(*) filter (where status = 'half_day')::numeric as half_days,
           count(*) filter (where status = 'absent')::numeric as absent,
           count(*) filter (where status = 'paid_leave')::numeric as paid_leave,
           count(*) filter (where late_minutes > 0)::numeric as late_days,
           count(*)::numeric as marked
    from public.attendance where staff_id = s.id and date between m2.m0 and m2.m1
  ) a on true
  cross join lateral (
    select round(case when s.pay_type = 'daily'
             then coalesce(a.present, 0) + coalesce(a.half_days, 0) / 2 + coalesce(a.paid_leave, 0)
             else greatest(0, m2.days - coalesce(a.absent, 0) - coalesce(a.half_days, 0) / 2) end, 1) as paid_days
  ) d
  cross join lateral (
    select d.paid_days,
           round(case when s.pay_type = 'daily' then s.salary * d.paid_days
                      else s.salary * d.paid_days / m2.days end, 2) as earned
  ) x
  left join lateral (
    select sum(coalesce(sa.total_amount, 0) - coalesce(sa.tax_amount, 0)) as total
    from public.sales sa
    where s.user_id is not null and sa.cashier_id = s.user_id and s.commission_pct > 0
      and coalesce(sa.status, 'completed') <> 'cancelled'
      and (sa.created_at at time zone 'Asia/Kolkata')::date between m2.m0 and m2.m1
  ) sl on true
  left join lateral (
    select sum(amount) as total from public.staff_advances
    where staff_id = s.id and payroll_id is null and given_on <= m2.m1
  ) adv on true
  left join public.staff_payroll p on p.staff_id = s.id and p.month = m2.m0
  where (s.is_active or p.id is not null)
    and (p_location_id is null or s.location_id = p_location_id)
    and (s.joined_on is null or s.joined_on <= m2.m1)
  order by s.name
$$;
grant execute on function public.staff_month_summary(date, uuid) to authenticated;

-- ---------- Advance: money given now, taken back from the next salary
create or replace function public.give_staff_advance(p_staff_id uuid, p_amount numeric, p_method text default 'cash', p_from_till boolean default true, p_note text default null)
returns public.staff_advances language plpgsql security definer set search_path = public as $$
declare
  v_staff public.staff;
  v_exp public.expenses;
  v_row public.staff_advances;
begin
  select * into v_staff from public.staff where id = p_staff_id;
  if v_staff.id is null then raise exception 'Staff member not found'; end if;
  if not public.can_manage_staff(v_staff.location_id) then raise exception 'Your role doesn''t allow staff pay'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter the advance amount'; end if;
  insert into public.expenses (amount, category, description, date, created_by, location_id, payment_method, paid_from_till, payee)
  values (round(p_amount, 2), 'Salary', 'Advance' || coalesce(': ' || nullif(trim(p_note), ''), ''), (now() at time zone 'Asia/Kolkata')::date,
          auth.uid(), v_staff.location_id, coalesce(p_method, 'cash'), coalesce(p_from_till, true) and coalesce(p_method, 'cash') = 'cash', v_staff.name)
  returning * into v_exp;
  insert into public.staff_advances (staff_id, location_id, amount, expense_id, note)
  values (v_staff.id, v_staff.location_id, round(p_amount, 2), v_exp.id, nullif(trim(p_note), ''))
  returning * into v_row;
  return v_row;
end;
$$;
grant execute on function public.give_staff_advance(uuid, numeric, text, boolean, text) to authenticated;

-- ---------- Pay the month's salary (once per person per month)
create or replace function public.pay_staff_salary(p_staff_id uuid, p_month date, p_bonus numeric default 0, p_deductions numeric default 0,
                                                   p_method text default 'cash', p_from_till boolean default false, p_note text default null)
returns public.staff_payroll language plpgsql security definer set search_path = public as $$
declare
  v_staff public.staff;
  v_m0 date := date_trunc('month', p_month)::date;
  v_sum record;
  v_net numeric;
  v_exp public.expenses;
  v_row public.staff_payroll;
begin
  select * into v_staff from public.staff where id = p_staff_id for update;
  if v_staff.id is null then raise exception 'Staff member not found'; end if;
  if not public.can_manage_staff(v_staff.location_id) then raise exception 'Your role doesn''t allow staff pay'; end if;
  if v_m0 > (now() at time zone 'Asia/Kolkata')::date then raise exception 'This month hasn''t started yet'; end if;
  if exists (select 1 from public.staff_payroll where staff_id = p_staff_id and month = v_m0) then
    raise exception 'Salary for this month is already paid';
  end if;
  if coalesce(p_bonus, 0) < 0 or coalesce(p_deductions, 0) < 0 then raise exception 'Bonus and deductions can''t be negative'; end if;
  select * into v_sum from public.staff_month_summary(v_m0, v_staff.location_id) s where s.staff_id = p_staff_id;
  if v_sum.staff_id is null then raise exception 'Nothing to pay for this month'; end if;
  v_net := round(v_sum.earned + v_sum.commission + coalesce(p_bonus, 0) - coalesce(p_deductions, 0) - v_sum.advances, 2);
  if v_net < 0 then raise exception 'Advances (%) are more than this month''s pay. Lower the deductions or pay next month.', v_sum.advances; end if;
  if v_net > 0 then
    insert into public.expenses (amount, category, description, date, created_by, location_id, payment_method, paid_from_till, payee)
    values (v_net, 'Salary', 'Salary ' || to_char(v_m0, 'Mon YYYY') || coalesce(': ' || nullif(trim(p_note), ''), ''),
            (now() at time zone 'Asia/Kolkata')::date, auth.uid(), v_staff.location_id, coalesce(p_method, 'cash'),
            coalesce(p_from_till, false) and coalesce(p_method, 'cash') = 'cash', v_staff.name)
    returning * into v_exp;
  end if;
  insert into public.staff_payroll (staff_id, location_id, month, paid_days, earned, commission, bonus, deductions, advances, net_paid, expense_id, note)
  values (v_staff.id, v_staff.location_id, v_m0, v_sum.paid_days, v_sum.earned, v_sum.commission, coalesce(p_bonus, 0), coalesce(p_deductions, 0),
          v_sum.advances, v_net, v_exp.id, nullif(trim(p_note), ''))
  returning * into v_row;
  update public.staff_advances set payroll_id = v_row.id
  where staff_id = p_staff_id and payroll_id is null and given_on <= (v_m0 + interval '1 month - 1 day')::date;
  return v_row;
end;
$$;
grant execute on function public.pay_staff_salary(uuid, date, numeric, numeric, text, boolean, text) to authenticated;

do $$ begin
  if to_regprocedure('public.audit_row()') is not null then
    execute 'drop trigger if exists trg_audit on public.staff';
    execute 'create trigger trg_audit after insert or update or delete on public.staff for each row execute function public.audit_row()';
    execute 'drop trigger if exists trg_audit on public.staff_payroll';
    execute 'create trigger trg_audit after insert or update or delete on public.staff_payroll for each row execute function public.audit_row()';
  end if;
end $$;

notify pgrst, 'reload schema';
