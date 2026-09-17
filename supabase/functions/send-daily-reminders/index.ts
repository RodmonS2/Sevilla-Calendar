import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

type RepeatUnit = 'none' | 'day' | 'week' | 'month' | 'year';

type CalendarEvent = {
  id: string;
  title: string;
  event_date: string;
  start_time: string;
  participant_ids: string[];
  repeat_interval: number;
  repeat_unit: RepeatUnit;
};

type PushSubscriptionRow = {
  id: string;
  endpoint: string;
  family_id: 'mom' | 'dad';
  p256dh: string;
  auth: string;
};

const TIME_ZONE = 'America/Vancouver';
const REMINDER_KIND = '30-minute';
const CALENDAR_URL = 'https://rodmo-family-calendar.sliph320.chatgpt.site/';
const QUERY_RETRY_DELAYS_MS = [0, 350, 1000];

type DatabaseResult<T> = {
  data: T | null;
  error: { code?: string; message?: string } | null;
};

async function loadWithRetry<T>(load: () => PromiseLike<DatabaseResult<T>>) {
  let result: DatabaseResult<T> | null = null;
  for (const delay of QUERY_RETRY_DELAYS_MS) {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    result = await load();
    if (!result.error) return result;
  }
  return result as DatabaseResult<T>;
}

function dateParts(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return { year, month, day };
}

function occursOn(event: CalendarEvent, dateKey: string) {
  const start = dateParts(event.event_date);
  const target = dateParts(dateKey);
  const startValue = Date.UTC(start.year, start.month - 1, start.day);
  const targetValue = Date.UTC(target.year, target.month - 1, target.day);
  if (targetValue < startValue) return false;
  if (event.repeat_unit === 'none' || event.repeat_interval < 1) return targetValue === startValue;

  const dayDifference = Math.round((targetValue - startValue) / 86_400_000);
  if (event.repeat_unit === 'day') return dayDifference % event.repeat_interval === 0;
  if (event.repeat_unit === 'week') return dayDifference % (event.repeat_interval * 7) === 0;
  if (event.repeat_unit === 'month') {
    const monthDifference = (target.year - start.year) * 12 + target.month - start.month;
    return target.day === start.day && monthDifference % event.repeat_interval === 0;
  }
  return target.month === start.month
    && target.day === start.day
    && (target.year - start.year) % event.repeat_interval === 0;
}

function getLocalClock(date: Date) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function eventStartMinutes(time: string) {
  const [hours, minutes] = time.slice(0, 5).split(':').map(Number);
  return hours * 60 + minutes;
}

function formatTime(time: string) {
  const [hours, minutes] = time.slice(0, 5).split(':').map(Number);
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(2000, 0, 1, hours, minutes)));
}

Deno.serve(async (request) => {
  if (request.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) {
    return new Response('Unauthorized', { status: 401 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  const subject = Deno.env.get('VAPID_SUBJECT');
  if (!supabaseUrl || !serviceRoleKey || !publicKey || !privateKey || !subject) {
    return new Response('Reminder service is not configured', { status: 500 });
  }

  let scheduledAt = new Date();
  try {
    const body = await request.json();
    if (body?.scheduled_at) scheduledAt = new Date(body.scheduled_at);
  } catch {
    // Manual calls may omit a body.
  }

  const localClock = getLocalClock(scheduledAt);
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [{ data: events, error: eventsError }, { data: subscriptions, error: subscriptionsError }, { data: deliveries, error: deliveriesError }] = await Promise.all([
    loadWithRetry(() => supabase
      .from('calendar_events')
      .select('id,title,event_date,start_time,participant_ids,repeat_interval,repeat_unit')
      .lte('event_date', localClock.dateKey)),
    loadWithRetry(() => supabase
      .from('push_subscriptions')
      .select('id,endpoint,family_id,p256dh,auth')),
    loadWithRetry(() => supabase
      .from('push_reminder_deliveries')
      .select('subscription_id,event_id')
      .eq('occurrence_date', localClock.dateKey)
      .eq('reminder_kind', REMINDER_KIND)),
  ]);

  if (eventsError || subscriptionsError || deliveriesError) {
    console.error({ eventsError, subscriptionsError, deliveriesError });
    return new Response('Reminder data could not be loaded', { status: 500 });
  }

  const dueEvents = (events as CalendarEvent[]).filter((event) => {
    if (!occursOn(event, localClock.dateKey)) return false;
    const minutesUntilStart = eventStartMinutes(event.start_time) - localClock.minutes;
    // Send near the 30-minute mark, but catch up before the event starts if a
    // scheduler run failed or the event was created less than 30 minutes ahead.
    return minutesUntilStart >= 0 && minutesUntilStart <= 34;
  });
  if (dueEvents.length === 0 || subscriptions?.length === 0) {
    return Response.json({ sent: 0, due: dueEvents.length });
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  const delivered = new Set(
    (deliveries ?? []).map((delivery) => `${delivery.subscription_id}:${delivery.event_id}`),
  );
  let sent = 0;

  for (const subscription of subscriptions as PushSubscriptionRow[]) {
    for (const event of dueEvents) {
      if (!event.participant_ids.includes(subscription.family_id)) continue;
      const deliveryKey = `${subscription.id}:${event.id}`;
      if (delivered.has(deliveryKey)) continue;

      try {
        const pushResponse = await webpush.sendNotification({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        }, JSON.stringify({
          title: 'Family Calendar',
          body: `You have ${event.title} today at ${formatTime(event.start_time)}.`,
          tag: `event-${event.id}-${localClock.dateKey}`,
          url: CALENDAR_URL,
        }), { TTL: 3600, urgency: 'high' });

        console.log({
          message: 'Push reminder accepted',
          statusCode: pushResponse.statusCode,
          eventId: event.id,
          subscriptionId: subscription.id,
        });

        const { error: deliveryError } = await loadWithRetry(() => supabase
          .from('push_reminder_deliveries')
          .insert({
            subscription_id: subscription.id,
            event_id: event.id,
            occurrence_date: localClock.dateKey,
            reminder_kind: REMINDER_KIND,
          }));
        if (deliveryError && deliveryError.code !== '23505') console.error(deliveryError);
        delivered.add(deliveryKey);
        sent += 1;
      } catch (error) {
        const statusCode = typeof error === 'object' && error && 'statusCode' in error
          ? Number(error.statusCode)
          : 0;
        if (statusCode === 404 || statusCode === 410) {
          await supabase.from('push_subscriptions').delete().eq('id', subscription.id);
        } else {
          console.error(error);
        }
      }
    }
  }

  return Response.json({ sent, due: dueEvents.length });
});
