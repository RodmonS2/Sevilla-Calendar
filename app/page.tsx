'use client';

import { FormEvent, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react';

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

function fromDateKey(key: string) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
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

function roundToHalfHour(minutes: number) {
  return Math.round(minutes / 30) * 30;
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

function initialEvents(today: Date): CalendarEvent[] {
  return [
    {
      id: 'demo-dentist',
      title: 'Dentist checkup',
      date: toDateKey(today),
      startTime: '09:30',
      endTime: '10:30',
      participantIds: ['mom'],
      notes: 'Remember the insurance card.',
    },
    {
      id: 'demo-swimming',
      title: 'Swimming',
      date: toDateKey(addDays(today, 1)),
      startTime: '14:00',
      endTime: '15:30',
      participantIds: ['marra'],
      notes: 'Bring goggles and a towel.',
    },
    {
      id: 'demo-dinner',
      title: 'Family dinner',
      date: toDateKey(addDays(today, 2)),
      startTime: '17:30',
      endTime: '19:00',
      participantIds: ['mom', 'dad', 'marra', 'bella'],
      notes: 'Taco night at home.',
    },
    {
      id: 'demo-pickup',
      title: 'School pickup',
      date: toDateKey(addDays(today, -1)),
      startTime: '15:00',
      endTime: '15:45',
      participantIds: ['dad', 'bella'],
      notes: '',
    },
  ];
}

function CalendarHeader({ onPrevious, onNext, onToday }: { onPrevious: () => void; onNext: () => void; onToday: () => void }) {
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
      </nav>
    </header>
  );
}

function FamilyLegend({ activeIds, onToggle, onEveryone }: { activeIds: Set<string>; onToggle: (id: string) => void; onEveryone: () => void }) {
  const everyoneActive = activeIds.size === FAMILY.length;
  return (
    <section className="family-legend" aria-label="Filter family members">
      <button className={`everyone-pill ${everyoneActive ? 'active' : ''}`} aria-pressed={everyoneActive} onClick={onEveryone}>
        Everyone
      </button>
      {FAMILY.map((member) => {
        const active = activeIds.has(member.id);
        return (
          <button
            className={`family-pill ${active ? 'active' : 'inactive'}`}
            style={{ '--member-color': member.color, '--member-tint': member.tint } as React.CSSProperties}
            aria-pressed={active}
            onClick={() => onToggle(member.id)}
            key={member.id}
          >
            <span className="avatar" style={{ backgroundColor: member.color }}>{member.initial}</span>
            <span>{member.name}</span>
            <span className="filter-state" aria-hidden="true">{active ? '✓' : '+'}</span>
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
                <strong>{date.getDate()}</strong>
                {isToday && <small>Today</small>}
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

function EventEditor({ draft, error, onChange, onClose, onSave, onDelete }: {
  draft: EditorDraft;
  error: string;
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
            {onDelete && <button type="button" className="delete-button" onClick={onDelete}>Delete event</button>}
            <div className="primary-actions">
              <button type="button" className="cancel-button" onClick={onClose}>Cancel</button>
              <button type="submit" className="save-button">Save event</button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}

export default function FamilyCalendar() {
  const today = useMemo(() => {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    return date;
  }, []);
  const [anchorDate, setAnchorDate] = useState(today);
  const [events, setEvents] = useState<CalendarEvent[]>(() => initialEvents(today));
  const [activeIds, setActiveIds] = useState(() => new Set(FAMILY.map((member) => member.id)));
  const [draft, setDraft] = useState<EditorDraft | null>(null);
  const [formError, setFormError] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);
  const recenteringRef = useRef(false);
  const dragRef = useRef<{ x: number; scrollLeft: number } | null>(null);
  const days = useMemo(() => Array.from({ length: DAY_WINDOW }, (_, index) => addDays(anchorDate, index - LEAD_DAYS)), [anchorDate]);

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
  }, []);

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

  const saveEvent = (formEvent: FormEvent) => {
    formEvent.preventDefault();
    if (!draft) return;
    if (!draft.title.trim()) { setFormError('Please add an event name.'); return; }
    if (draft.participantIds.length === 0) { setFormError('Choose at least one family member.'); return; }
    if (timeToMinutes(draft.endTime) <= timeToMinutes(draft.startTime)) { setFormError('End time must be after start time.'); return; }
    const saved: CalendarEvent = {
      ...draft,
      id: draft.id ?? `event-${Date.now()}`,
      title: draft.title.trim(),
      notes: draft.notes.trim(),
    };
    setEvents((current) => draft.id ? current.map((event) => event.id === draft.id ? saved : event) : [...current, saved]);
    setDraft(null);
    setFormError('');
  };

  const deleteEvent = () => {
    if (!draft?.id) return;
    setEvents((current) => current.filter((event) => event.id !== draft.id));
    setDraft(null);
  };

  return (
    <main className="calendar-shell">
      <CalendarHeader onPrevious={() => moveByDays(-1)} onNext={() => moveByDays(1)} onToday={returnToday} />
      <FamilyLegend activeIds={activeIds} onToggle={toggleFilter} onEveryone={() => setActiveIds(new Set(FAMILY.map((member) => member.id)))} />
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
          onChange={(next) => { setDraft(next); setFormError(''); }}
          onClose={() => setDraft(null)}
          onSave={saveEvent}
          onDelete={draft.id ? deleteEvent : null}
        />
      )}
    </main>
  );
}
