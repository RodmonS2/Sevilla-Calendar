alter table public.calendar_events
  drop constraint if exists calendar_events_valid_participants;

alter table public.calendar_events
  add constraint calendar_events_valid_participants check (
    participant_ids <@ array['mom', 'dad', 'marra', 'bella', 'lola']::text[]
  );
