alter table public.calendar_events
  add column if not exists location text not null default '',
  add column if not exists repeat_interval smallint not null default 0,
  add column if not exists repeat_unit text not null default 'none';

alter table public.calendar_events
  drop constraint if exists calendar_events_valid_repeat;

alter table public.calendar_events
  add constraint calendar_events_valid_repeat check (
    (repeat_unit = 'none' and repeat_interval = 0)
    or (repeat_unit in ('day', 'week', 'month', 'year') and repeat_interval between 1 and 99)
  );
