alter table public.calendar_events
  drop constraint if exists calendar_events_valid_time;

alter table public.calendar_events
  add constraint calendar_events_valid_time check (end_time <> start_time);
