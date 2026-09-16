create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  family_id text not null check (family_id in ('mom', 'dad')),
  p256dh text not null,
  auth text not null,
  user_agent text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_push_subscriptions_user_id
on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;

revoke all on table public.push_subscriptions from anon;
grant select, insert, update, delete on table public.push_subscriptions to authenticated;

drop policy if exists "Family accounts manage their own phone reminders" on public.push_subscriptions;
create policy "Family accounts manage their own phone reminders"
on public.push_subscriptions
for all
to authenticated
using (user_id = (select auth.uid()))
with check (
  user_id = (select auth.uid())
  and lower(coalesce((select auth.jwt() ->> 'email'), '')) in (
    'cfbvaldez@gmail.com',
    'rodmonsevilla@gmail.com'
  )
);

create table if not exists public.push_reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  event_id uuid not null references public.calendar_events(id) on delete cascade,
  occurrence_date date not null,
  reminder_kind text not null default '30-minute',
  delivered_at timestamptz not null default now(),
  unique (subscription_id, event_id, occurrence_date, reminder_kind)
);

alter table public.push_reminder_deliveries enable row level security;
revoke all on table public.push_reminder_deliveries from anon, authenticated;

create index if not exists idx_push_reminder_deliveries_date
on public.push_reminder_deliveries(occurrence_date);

do $$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id
  from cron.job
  where jobname = 'send-family-calendar-reminders';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;
end;
$$;

select cron.schedule(
  'send-family-calendar-reminders',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'calendar_project_url') || '/functions/v1/send-daily-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'calendar_reminder_cron_secret')
    ),
    body := jsonb_build_object('scheduled_at', now())
  ) as request_id;
  $job$
);
