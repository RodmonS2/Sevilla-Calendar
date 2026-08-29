'use client';

import { FormEvent, PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

type FamilyMember = {
  id: string;
  name: string;
  color: string;
  tint: string;
  ink: string;
  initial: string;
};

type CalendarEvent = {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  participantIds: string[];
  notes: string;
};

type EditorDraft = Omit<CalendarEvent, 'id'> & { id?: string };

type DatabaseCalendarEvent = {
  id: string;
  title: string;
  event_date: string;
  start_time: string;
  end_time: string;
  participant_ids: string[];
  notes: string;
};

const ALLOWED_ACCOUNTS: Record<string, { name: string; familyId: 'mom' | 'dad' }> = {
  'cfbvaldez@gmail.com': { name: 'Corinna', familyId: 'mom' },
  'rodmonsevilla@gmail.com': { name: 'Rodmon', familyId: 'dad' },
};

const FAMILY: FamilyMember[] = [
  { id: 'mom', name: 'Mom', color: '#9B74E8', tint: '#F0EAFB', ink: '#543681', initial: 'M' },
  { id: 'dad', name: 'Dad', color: '#4C91E8', tint: '#E7F1FD', ink: '#225A9D', initial: 'D' },
  { id: 'marra', name: 'Marra', color: '#F080AE', tint: '#FCE8F0', ink: '#964264', initial: 'M' },
  { id: 'bella', name: 'Bella', color: '#F5BD4D', tint: '#FFF4D6', ink: '#7A5511', initial: 'B' },
];

const HOURS = Array.from({ length: 23 }, (_, index) => index + 1);
const HOUR_HEIGHT = 72;
const DAY_WINDOW = 11;
const LEAD_DAYS = 4;

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setHours(12, 0, 0, 0);
  next.setDate(next.getDate() + amount);
  return next;
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function timeToMinutes(time: string) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function formatHour(hour: number) {
  if (hour === 12) return '12 PM';
  return `${hour > 12 ? hour - 12 : hour} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function formatTime(time: string) {
  return new Date(`2000-01-01T${time}:00`).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function defaultDraft(date = new Date(), hour = 9): EditorDraft {
  const startHour = Math.min(Math.max(hour, 1), 22);
  return {
    title: '',
    date: toDateKey(date),
    startTime: `${String(startHour).padStart(2, '0')}:00`,
    endTime: `${String(startHour + 1).padStart(2, '0')}:00`,
    participantIds: [],
    notes: '',
  };
}

function fromDatabaseEvent(event: DatabaseCalendarEvent): CalendarEvent {
  return {
    id: event.id,
    title: event.title,
    date: event.event_date,
    startTime: event.start_time.slice(0, 5),
    endTime: event.end_time.slice(0, 5),
    participantIds: event.participant_ids,
    notes: event.notes ?? '',
  };
}

function CalendarHeader({ onPrevious, onNext, onToday, accountName, accountColor, onSignOut }: {
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
  accountName: string;
  accountColor: string;
  onSignOut: () => void;
}) {
  return (
    <header className="topbar">
      <div>
        <p className="eyebrow">Family calendar</p>
        <h1>Our days, together.</h1>
      </div>
      <nav className="calendar-actions" aria-label="Calendar navigation">
        <button aria-label="Previous day" className="icon-button" onClick={onPrevious}>←</button>
        <button className="today-button" onClick={onToday}>Today</button>
        <button aria-label="Next day" className="icon-button" onClick={onNext}>→</button>
        <div className="account-menu">
          <span className="account-avatar" style={{ backgroundColor: accountColor }}>{accountName.charAt(0)}</span>
          <span className="account-name">{accountName}</span>
          <button className="sign-out-button" type="button" onClick={onSignOut}>Sign out</button>
        </div>
      </nav>
    </header>
  );
}

function FamilyLegend({ activeIds, onToggle }: { activeIds: Set<string>; onToggle: (id: string) => void }) {
  return (
    <section className="family-legend" aria-label="Filter family members">
      {FAMILY.map((member) => {
        const active = activeIds.has(member.id);
        return (
          <button
            className={`family-avatar-button ${active ? 'active' : 'inactive'}`}
            style={{ '--member-color': member.color, '--member-tint': member.tint } as React.CSSProperties}
            aria-pressed={active}
            aria-label={`${active ? 'Hide' : 'Show'} ${member.name}'s events`}
            title={`${member.name} — ${active ? 'visible' : 'hidden'}`}
            onClick={() => onToggle(member.id)}
            key={member.id}
          >
            <span className="family-avatar" style={{ backgroundColor: active ? member.color : undefined }}>{member.initial}</span>
            <span className="sr-only">{member.name}</span>
          </button>
        );
      })}
    </section>
  );
}

function TimeColumn() {
  return (
    <div className="time-column" aria-hidden="true">
      {HOURS.map((hour) => <div className="time-slot" key={hour}>{formatHour(hour)}</div>)}
    </div>
  );
}

function CalendarEventCard({ event, activeIds, onOpen }: { event: CalendarEvent; activeIds: Set<string>; onOpen: (event: CalendarEvent) => void }) {
  const participants = event.participantIds.map((id) => FAMILY.find((member) => member.id === id)).filter(Boolean) as FamilyMember[];
  const single = participants.length === 1 ? participants[0] : null;
  const visible = event.participantIds.some((id) => activeIds.has(id));
  const start = timeToMinutes(event.startTime);
  const duration = Math.max(timeToMinutes(event.endTime) - start, 30);
  const top = Math.max(0, ((start - 60) / 60) * HOUR_HEIGHT);
  const height = Math.max(34, (duration / 60) * HOUR_HEIGHT - 3);

  return (
    <button
      className={`calendar-event ${single ? 'single-person' : 'multi-person'} ${visible ? '' : 'filtered'}`}
      style={{
        top,
        height,
        '--event-color': single?.color ?? '#B8BBC1',
        '--event-tint': single?.tint ?? '#F4F4F2',
        '--event-ink': single?.ink ?? '#30343B',
      } as React.CSSProperties}
      onClick={(clickEvent) => { clickEvent.stopPropagation(); onOpen(event); }}
      aria-label={`${event.title}, ${formatTime(event.startTime)} to ${formatTime(event.endTime)}, ${participants.map((person) => person.name).join(' and ')}`}
    >
      {!single && (
        <span className="event-dots" aria-hidden="true">
          {participants.map((person) => <i key={person.id} style={{ backgroundColor: person.color }} />)}
        </span>
      )}
      <strong>{event.title}</strong>
      <span className="event-time">{formatTime(event.startTime)}–{formatTime(event.endTime)}</span>
      <span className="event-people">{participants.map((person) => person.name).join(' + ')}</span>
    </button>
  );
}

function DayColumn({ date, events, activeIds, onOpenEvent, onEmptySlot }: {
  date: Date;
  events: CalendarEvent[];
  activeIds: Set<string>;
  onOpenEvent: (event: CalendarEvent) => void;
  onEmptySlot: (date: Date, hour: number) => void;
}) {
  const isToday = toDateKey(date) === toDateKey(new Date());
  return (
    <div className={`day-column ${isToday ? 'today-column' : ''}`} data-date={toDateKey(date)}>
      {HOURS.map((hour) => (
        <button
          className="hour-cell"
          aria-label={`Add event on ${date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} at ${formatHour(hour)}`}
          onClick={() => onEmptySlot(date, hour)}
          key={hour}
        />
      ))}
      {events.map((event) => (
        <CalendarEventCard event={event} activeIds={activeIds} onOpen={onOpenEvent} key={event.id} />
      ))}
    </div>
  );
}

function ThreeDayView({ days, events, activeIds, scrollRef, onOpenEvent, onEmptySlot, onScroll, onPointerDown }: {
  days: Date[];
  events: CalendarEvent[];
  activeIds: Set<string>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onOpenEvent: (event: CalendarEvent) => void;
  onEmptySlot: (date: Date, hour: number) => void;
  onScroll: () => void;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  const todayKey = toDateKey(new Date());
  return (
    <section className="calendar-card" aria-label="Family calendar">
      <div className="calendar-scroll" ref={scrollRef} onScroll={onScroll} onPointerDown={onPointerDown}>
        <div className="date-header calendar-columns">
          <div className="time-heading">Time</div>
          {days.map((date) => {
            const isToday = toDateKey(date) === todayKey;
            return (
              <div className={`date-heading ${isToday ? 'is-today' : ''}`} key={toDateKey(date)}>
                <span>{date.toLocaleDateString('en-US', { weekday: 'short' })}</span>
                <strong className="date-number">{date.getDate()}</strong>
              </div>
            );
          })}
        </div>
        <div className="calendar-grid calendar-columns">
          <TimeColumn />
          {days.map((date) => (
            <DayColumn
              date={date}
              events={events.filter((event) => event.date === toDateKey(date))}
              activeIds={activeIds}
              onOpenEvent={onOpenEvent}
              onEmptySlot={onEmptySlot}
              key={toDateKey(date)}
            />
          ))}
        </div>
      </div>
      <p className="scroll-hint">Swipe or drag to move through days</p>
    </section>
  );
}

function EventEditor({ draft, error, saving, onChange, onClose, onSave, onDelete }: {
  draft: EditorDraft;
  error: string;
  saving: boolean;
  onChange: (draft: EditorDraft) => void;
  onClose: () => void;
  onSave: (event: FormEvent) => void;
  onDelete: (() => void) | null;
}) {
  const toggleParticipant = (id: string) => {
    const participantIds = draft.participantIds.includes(id)
      ? draft.participantIds.filter((participantId) => participantId !== id)
      : [...draft.participantIds, id];
    onChange({ ...draft, participantIds });
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="event-editor" role="dialog" aria-modal="true" aria-labelledby="editor-title">
        <div className="editor-heading">
          <div>
            <p className="eyebrow">{draft.id ? 'Event details' : 'New event'}</p>
            <h2 id="editor-title">{draft.id ? 'Edit event' : 'Add event'}</h2>
          </div>
          <button className="close-button" aria-label="Close" type="button" onClick={onClose}>×</button>
        </div>
        <form onSubmit={onSave}>
          <label className="field field-full">
            <span>Event name</span>
            <input autoFocus required value={draft.title} placeholder="Doctor appointment" onChange={(event) => onChange({ ...draft, title: event.target.value })} />
          </label>
          <div className="field-row">
            <label className="field">
              <span>Date</span>
              <input type="date" required value={draft.date} onChange={(event) => onChange({ ...draft, date: event.target.value })} />
            </label>
            <label className="field">
              <span>Start time</span>
              <input type="time" min="01:00" max="23:00" step="900" required value={draft.startTime} onChange={(event) => onChange({ ...draft, startTime: event.target.value })} />
            </label>
            <label className="field">
              <span>End time</span>
              <input type="time" min="01:15" max="23:59" step="900" required value={draft.endTime} onChange={(event) => onChange({ ...draft, endTime: event.target.value })} />
            </label>
          </div>
          <fieldset className="participant-field">
            <legend>Family members</legend>
            <div className="participant-options">
              {FAMILY.map((member) => {
                const selected = draft.participantIds.includes(member.id);
                return (
                  <button
                    type="button"
                    className={`participant-chip ${selected ? 'selected' : ''}`}
                    style={{ '--member-color': member.color, '--member-tint': member.tint } as React.CSSProperties}
                    aria-pressed={selected}
                    onClick={() => toggleParticipant(member.id)}
                    key={member.id}
                  >
                    <span className="avatar small" style={{ backgroundColor: member.color }}>{selected ? '✓' : member.initial}</span>
                    {member.name}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <label className="field field-full">
            <span>Notes <em>Optional</em></span>
            <textarea rows={3} value={draft.notes} placeholder="Anything the family should know?" onChange={(event) => onChange({ ...draft, notes: event.target.value })} />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="editor-actions">
            {onDelete && <button type="button" className="delete-button" disabled={saving} onClick={onDelete}>Delete event</button>}
            <div className="primary-actions">
              <button type="button" className="cancel-button" disabled={saving} onClick={onClose}>Cancel</button>
              <button type="submit" className="save-button" disabled={saving}>{saving ? 'Saving…' : 'Save event'}</button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}

function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!ALLOWED_ACCOUNTS[normalizedEmail]) {
      setError('This calendar is limited to the two family accounts.');
      return;
    }
    if (!supabase) {
      setError('The calendar connection is not configured yet.');
      return;
    }
    setSubmitting(true);
    setError('');
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });
    if (signInError) {
      setError('Email or password is incorrect. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-family" aria-hidden="true">
          {FAMILY.map((member) => (
            <span className="login-family-avatar" style={{ backgroundColor: member.color }} key={member.id}>{member.initial}</span>
          ))}
        </div>
        <p className="eyebrow">Sevilla family calendar</p>
        <h1 id="login-title">Welcome home.</h1>
        <p className="login-copy">Sign in to see and update the family schedule.</p>
        <form className="login-form" onSubmit={signIn}>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              placeholder="you@example.com"
              onChange={(event) => { setEmail(event.target.value); setError(''); }}
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              placeholder="Your password"
              onChange={(event) => { setPassword(event.target.value); setError(''); }}
            />
          </label>
          {error && <p className="login-error" role="alert">{error}</p>}
          <button className="login-button" type="submit" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="login-note">Private access for Corinna and Rodmon</p>
      </section>
    </main>
  );
}

function LoadingScreen({ message = 'Opening the family calendar…' }: { message?: string }) {
  return (
    <main className="login-shell">
      <div className="loading-card" role="status">
        <span className="loading-mark" aria-hidden="true" />
        <p>{message}</p>
      </div>
    </main>
  );
}

export default function FamilyCalendar() {
  const today = useMemo(() => {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    return date;
  }, []);
  const [anchorDate, setAnchorDate] = useState(today);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [activeIds, setActiveIds] = useState(() => new Set(FAMILY.map((member) => member.id)));
  const [draft, setDraft] = useState<EditorDraft | null>(null);
  const [formError, setFormError] = useState('');
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(isSupabaseConfigured);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [dataError, setDataError] = useState('');
  const [saving, setSaving] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);
  const recenteringRef = useRef(false);
  const dragRef = useRef<{ x: number; scrollLeft: number } | null>(null);
  const days = useMemo(() => Array.from({ length: DAY_WINDOW }, (_, index) => addDays(anchorDate, index - LEAD_DAYS)), [anchorDate]);
  const accountEmail = session?.user.email?.toLowerCase() ?? '';
  const account = ALLOWED_ACCOUNTS[accountEmail];
  const accountMember = FAMILY.find((member) => member.id === account?.familyId);

  const loadEvents = useCallback(async () => {
    if (!supabase) return;
    setEventsLoading(true);
    const { data, error } = await supabase
      .from('calendar_events')
      .select('id,title,event_date,start_time,end_time,participant_ids,notes')
      .order('event_date', { ascending: true })
      .order('start_time', { ascending: true });
    if (error) {
      setDataError(error.code === '42P01'
        ? 'The calendar database needs its one-time setup before events can be saved.'
        : 'The shared calendar could not be loaded. Please try again.');
    } else {
      setEvents((data as DatabaseCalendarEvent[]).map(fromDatabaseEvent));
      setDataError('');
    }
    setEventsLoading(false);
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let mounted = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      const email = data.session?.user.email?.toLowerCase() ?? '';
      if (data.session && !ALLOWED_ACCOUNTS[email]) {
        void supabase?.auth.signOut();
        setSession(null);
      } else {
        setSession(data.session);
      }
      setAuthLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      const email = nextSession?.user.email?.toLowerCase() ?? '';
      if (nextSession && !ALLOWED_ACCOUNTS[email]) {
        void supabase?.auth.signOut();
        setSession(null);
      } else {
        setSession(nextSession);
      }
      setAuthLoading(false);
    });
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!supabase || !session) return;
    const initialLoad = window.setTimeout(() => { void loadEvents(); }, 0);
    const channel = supabase
      .channel('calendar-event-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_events' }, () => {
        void loadEvents();
      })
      .subscribe();
    return () => {
      window.clearTimeout(initialLoad);
      void supabase?.removeChannel(channel);
    };
  }, [session, loadEvents]);

  const getDayWidth = () => {
    const scroller = scrollRef.current;
    if (!scroller) return 280;
    const timeWidth = window.innerWidth <= 700 ? 64 : 82;
    return Math.max(window.innerWidth <= 700 ? 190 : 240, (scroller.clientWidth - timeWidth) / 3);
  };

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || initializedRef.current) return;
    initializedRef.current = true;
    requestAnimationFrame(() => {
      scroller.scrollLeft = LEAD_DAYS * getDayWidth();
      scroller.scrollTop = 7.75 * HOUR_HEIGHT;
    });
  }, [session]);

  useEffect(() => {
    if (!draft) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setDraft(null); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [draft]);

  const moveByDays = (amount: number) => {
    setAnchorDate((current) => addDays(current, amount));
  };

  const returnToday = () => {
    setAnchorDate(today);
    requestAnimationFrame(() => {
      const scroller = scrollRef.current;
      if (scroller) scroller.scrollLeft = LEAD_DAYS * getDayWidth();
    });
  };

  const handleScroll = () => {
    const scroller = scrollRef.current;
    if (!scroller || recenteringRef.current) return;
    const dayWidth = getDayWidth();
    const center = LEAD_DAYS * dayWidth;
    const distance = scroller.scrollLeft - center;
    if (Math.abs(distance) < dayWidth) return;
    const shift = Math.trunc(distance / dayWidth);
    if (shift === 0) return;
    recenteringRef.current = true;
    setAnchorDate((current) => addDays(current, shift));
    requestAnimationFrame(() => {
      scroller.scrollLeft -= shift * dayWidth;
      recenteringRef.current = false;
    });
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch' || (event.target as HTMLElement).closest('button, input, textarea')) return;
    const scroller = scrollRef.current;
    if (!scroller) return;
    dragRef.current = { x: event.clientX, scrollLeft: scroller.scrollLeft };
    scroller.classList.add('is-dragging');
    scroller.setPointerCapture(event.pointerId);
    const handleMove = (moveEvent: PointerEvent) => {
      if (!dragRef.current) return;
      scroller.scrollLeft = dragRef.current.scrollLeft - (moveEvent.clientX - dragRef.current.x);
    };
    const handleUp = () => {
      dragRef.current = null;
      scroller.classList.remove('is-dragging');
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  };

  const toggleFilter = (id: string) => {
    setActiveIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const openEmptySlot = (date: Date, hour: number) => {
    setFormError('');
    setDraft(defaultDraft(date, hour));
  };

  const saveEvent = async (formEvent: FormEvent) => {
    formEvent.preventDefault();
    if (!draft || !supabase) return;
    if (!draft.title.trim()) { setFormError('Please add an event name.'); return; }
    if (draft.participantIds.length === 0) { setFormError('Choose at least one family member.'); return; }
    if (timeToMinutes(draft.endTime) <= timeToMinutes(draft.startTime)) { setFormError('End time must be after start time.'); return; }
    setSaving(true);
    const payload = {
      title: draft.title.trim(),
      event_date: draft.date,
      start_time: draft.startTime,
      end_time: draft.endTime,
      participant_ids: draft.participantIds,
      notes: draft.notes.trim(),
    };
    const query = draft.id
      ? supabase.from('calendar_events').update(payload).eq('id', draft.id)
      : supabase.from('calendar_events').insert(payload);
    const { data, error } = await query
      .select('id,title,event_date,start_time,end_time,participant_ids,notes')
      .single();
    if (error) {
      setFormError('This event could not be saved. Please check the database setup and try again.');
      setSaving(false);
      return;
    }
    const saved = fromDatabaseEvent(data as DatabaseCalendarEvent);
    setEvents((current) => draft.id
      ? current.map((event) => event.id === draft.id ? saved : event)
      : [...current, saved]);
    setDraft(null);
    setFormError('');
    setSaving(false);
  };

  const deleteEvent = async () => {
    if (!draft?.id || !supabase) return;
    setSaving(true);
    const { error } = await supabase.from('calendar_events').delete().eq('id', draft.id);
    if (error) {
      setFormError('This event could not be deleted. Please try again.');
      setSaving(false);
      return;
    }
    setEvents((current) => current.filter((event) => event.id !== draft.id));
    setDraft(null);
    setSaving(false);
  };

  if (!isSupabaseConfigured) {
    return <LoadingScreen message="The calendar connection is not configured." />;
  }

  if (authLoading) {
    return <LoadingScreen />;
  }

  if (!session || !account) {
    return <LoginScreen />;
  }

  return (
    <main className="calendar-shell">
      <CalendarHeader
        onPrevious={() => moveByDays(-1)}
        onNext={() => moveByDays(1)}
        onToday={returnToday}
        accountName={account.name}
        accountColor={accountMember?.color ?? '#9B74E8'}
        onSignOut={() => { void supabase?.auth.signOut(); }}
      />
      <FamilyLegend activeIds={activeIds} onToggle={toggleFilter} />
      {(dataError || (eventsLoading && events.length === 0)) && (
        <div className={`sync-banner ${dataError ? 'error' : ''}`} role="status">
          <span>{dataError || 'Syncing the family schedule…'}</span>
          {dataError && <button type="button" onClick={() => { void loadEvents(); }}>Try again</button>}
        </div>
      )}
      <ThreeDayView
        days={days}
        events={events}
        activeIds={activeIds}
        scrollRef={scrollRef}
        onOpenEvent={(event) => { setFormError(''); setDraft({ ...event }); }}
        onEmptySlot={openEmptySlot}
        onScroll={handleScroll}
        onPointerDown={handlePointerDown}
      />
      <button className="add-button" aria-label="Add event" onClick={() => { setFormError(''); setDraft(defaultDraft(anchorDate)); }}>+</button>
      {draft && (
        <EventEditor
          draft={draft}
          error={formError}
          saving={saving}
          onChange={(next) => { setDraft(next); setFormError(''); }}
          onClose={() => setDraft(null)}
          onSave={saveEvent}
          onDelete={draft.id ? deleteEvent : null}
        />
      )}
    </main>
  );
}
