-- Sevilla Calendar database setup
-- Run this entire file in Supabase Dashboard > SQL Editor once.

create extension if not exists pgcrypto;

create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 120),
  event_date date not null,
  start_time time not null,
  end_time time not null,
  participant_ids text[] not null check (cardinality(participant_ids) > 0),
  location text not null default '',
  notes text not null default '',
  repeat_interval smallint not null default 0,
  repeat_unit text not null default 'none',
  notification_value smallint,
  notification_unit text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_events_valid_time check (end_time <> start_time),
  constraint calendar_events_valid_participants check (
    participant_ids <@ array['mom', 'dad', 'marra', 'bella', 'lola']::text[]
  ),
  constraint calendar_events_valid_repeat check (
    (repeat_unit = 'none' and repeat_interval = 0)
    or (repeat_unit in ('day', 'week', 'month', 'year') and repeat_interval between 1 and 99)
  ),
  constraint calendar_events_valid_notification check (
    (notification_value is null and notification_unit is null)
    or (
      notification_value is not null
      and notification_unit is not null
      and (
        (notification_unit = 'minute' and notification_value between 0 and 60)
        or (notification_unit = 'hour' and notification_value between 0 and 24)
        or (notification_unit = 'day' and notification_value between 0 and 28)
        or (notification_unit = 'week' and notification_value between 0 and 4)
      )
    )
  )
);

-- Keep existing installations aligned when the event model changes.
alter table public.calendar_events
  add column if not exists location text not null default '',
  add column if not exists repeat_interval smallint not null default 0,
  add column if not exists repeat_unit text not null default 'none',
  add column if not exists notification_value smallint,
  add column if not exists notification_unit text;

alter table public.calendar_events
  drop constraint if exists calendar_events_valid_time;

alter table public.calendar_events
  add constraint calendar_events_valid_time check (end_time <> start_time);

alter table public.calendar_events
  drop constraint if exists calendar_events_valid_participants;

alter table public.calendar_events
  add constraint calendar_events_valid_participants check (
    participant_ids <@ array['mom', 'dad', 'marra', 'bella', 'lola']::text[]
  );

alter table public.calendar_events
  drop constraint if exists calendar_events_valid_repeat;

alter table public.calendar_events
  add constraint calendar_events_valid_repeat check (
    (repeat_unit = 'none' and repeat_interval = 0)
    or (repeat_unit in ('day', 'week', 'month', 'year') and repeat_interval between 1 and 99)
  );

alter table public.calendar_events
  drop constraint if exists calendar_events_valid_notification;

alter table public.calendar_events
  add constraint calendar_events_valid_notification check (
    (notification_value is null and notification_unit is null)
    or (
      notification_value is not null
      and notification_unit is not null
      and (
        (notification_unit = 'minute' and notification_value between 0 and 60)
        or (notification_unit = 'hour' and notification_value between 0 and 24)
        or (notification_unit = 'day' and notification_value between 0 and 28)
        or (notification_unit = 'week' and notification_value between 0 and 4)
      )
    )
  );

create or replace function public.set_calendar_event_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists calendar_events_set_updated_at on public.calendar_events;
create trigger calendar_events_set_updated_at
before update on public.calendar_events
for each row execute function public.set_calendar_event_updated_at();

alter table public.calendar_events enable row level security;
alter table public.calendar_events replica identity full;

revoke all on table public.calendar_events from anon;
grant select, insert, update, delete on table public.calendar_events to authenticated;

drop policy if exists "Two family accounts can view events" on public.calendar_events;
create policy "Two family accounts can view events"
on public.calendar_events
for select
to authenticated
using (
  lower(coalesce((select auth.jwt() ->> 'email'), '')) in (
    'cfbvaldez@gmail.com',
    'rodmonsevilla@gmail.com'
  )
);

drop policy if exists "Two family accounts can create events" on public.calendar_events;
create policy "Two family accounts can create events"
on public.calendar_events
for insert
to authenticated
with check (
  lower(coalesce((select auth.jwt() ->> 'email'), '')) in (
    'cfbvaldez@gmail.com',
    'rodmonsevilla@gmail.com'
  )
  and created_by = (select auth.uid())
);

drop policy if exists "Two family accounts can update events" on public.calendar_events;
create policy "Two family accounts can update events"
on public.calendar_events
for update
to authenticated
using (
  lower(coalesce((select auth.jwt() ->> 'email'), '')) in (
    'cfbvaldez@gmail.com',
    'rodmonsevilla@gmail.com'
  )
)
with check (
  lower(coalesce((select auth.jwt() ->> 'email'), '')) in (
    'cfbvaldez@gmail.com',
    'rodmonsevilla@gmail.com'
  )
);

drop policy if exists "Two family accounts can delete events" on public.calendar_events;
create policy "Two family accounts can delete events"
on public.calendar_events
for delete
to authenticated
using (
  lower(coalesce((select auth.jwt() ->> 'email'), '')) in (
    'cfbvaldez@gmail.com',
    'rodmonsevilla@gmail.com'
  )
);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'calendar_events'
  ) then
    alter publication supabase_realtime add table public.calendar_events;
  end if;
end;
$$;
