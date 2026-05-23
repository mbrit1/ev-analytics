-- Hard cutover for session mode + provider plan selection history.
-- Assumption: no production data requires backward-compatible migration.

create table if not exists public.provider_plan_selections (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_id uuid not null references public.providers(id),
  tariff_plan_id uuid not null references public.charging_plans(id),
  valid_from timestamptz not null,
  valid_to timestamptz null,
  price_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

alter table public.provider_plan_selections enable row level security;

drop policy if exists "Users can select own provider plan selections" on public.provider_plan_selections;
create policy "Users can select own provider plan selections"
on public.provider_plan_selections
for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own provider plan selections" on public.provider_plan_selections;
create policy "Users can insert own provider plan selections"
on public.provider_plan_selections
for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update own provider plan selections" on public.provider_plan_selections;
create policy "Users can update own provider plan selections"
on public.provider_plan_selections
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.charging_sessions
  add column if not exists session_mode text,
  add column if not exists tariff_plan_id uuid references public.charging_plans(id),
  add column if not exists plan_selection_id uuid references public.provider_plan_selections(id),
  add column if not exists price_snapshot jsonb;

update public.charging_sessions
set session_mode = case
  when pricing_source = 'adHoc' then 'adHoc'
  else 'plan'
end
where session_mode is null;

update public.charging_sessions
set tariff_plan_id = charging_plan_id
where tariff_plan_id is null and charging_plan_id is not null;

alter table public.charging_sessions
  alter column session_mode set not null,
  alter column price_snapshot set default '{}'::jsonb,
  alter column price_snapshot set not null;

alter table public.charging_sessions
  drop constraint if exists charging_sessions_session_mode_check;
alter table public.charging_sessions
  add constraint charging_sessions_session_mode_check
  check (session_mode in ('plan', 'adHoc'));

alter table public.charging_sessions
  drop constraint if exists charging_sessions_plan_mode_requirements;
alter table public.charging_sessions
  add constraint charging_sessions_plan_mode_requirements
  check (
    (session_mode = 'plan' and tariff_plan_id is not null)
    or
    (session_mode = 'adHoc' and tariff_plan_id is null and plan_selection_id is null)
  );
