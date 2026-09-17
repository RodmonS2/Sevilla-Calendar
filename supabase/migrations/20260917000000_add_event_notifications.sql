alter table public.calendar_events
  add column if not exists notification_value smallint,
  add column if not exists notification_unit text;

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
