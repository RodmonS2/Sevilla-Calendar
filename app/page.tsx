'use client';

import { FormEvent, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

type RepeatUnit = 'none' | 'day' | 'week' | 'month' | 'year';

type CalendarEvent = {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  participantIds: string[];
  location: string;
  notes: string;
  repeatInterval: number;
  repeatUnit: RepeatUnit;
};

type EditorDraft = Omit<CalendarEvent, 'id'> & { id?: string };
type CalendarViewMode = 'day' | 'three-day' | 'month';

type DatabaseCalendarEvent = {
  id: string;
  title: string;
  event_date: string;
  start_time: string;
  end_time: string;
  participant_ids: string[];
  location: string;
  notes: string;
  repeat_interval: number;
  repeat_unit: RepeatUnit;
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
  { id: 'lola', name: 'Lola', color: '#78C9A3', tint: '#E5F6EC', ink: '#2F6B52', initial: 'L' },
];

const HOURS = Array.from({ length: 23 }, (_, index) => index + 1);
const HOUR_HEIGHT: Record<Exclude<CalendarViewMode, 'month'>, number> = {
  day: 40,
  'three-day': 38,
};
const VIEW_OPTIONS: { id: CalendarViewMode; label: string }[] = [
  { id: 'day', label: 'Day' },
  { id: 'three-day', label: '3 Day' },
  { id: 'month', label: 'Month' },
];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DATABASE_EVENT_FIELDS = 'id,title,event_date,start_time,end_time,participant_ids,location,notes,repeat_interval,repeat_unit';
const REPEAT_OPTIONS: { label: string; interval: number; unit: RepeatUnit }[] = [
  { label: 'Does not repeat', interval: 0, unit: 'none' },
  { label: 'Every day', interval: 1, unit: 'day' },
  { label: 'Every week', interval: 1, unit: 'week' },
  { label: 'Every month', interval: 1, unit: 'month' },
  { label: 'Every year', interval: 1, unit: 'year' },
];

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setHours(12, 0, 0, 0);
  next.setDate(next.getDate() + amount);
  return next;
}

function addMonths(date: Date, amount: number) {
  const next = new Date(date.getFullYear(), date.getMonth() + amount, 1, 12);
  return next;
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateKeyParts(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return { year, month, day };
}

function eventOccursOn(event: CalendarEvent, dateKey: string) {
  const start = dateKeyParts(event.date);
  const target = dateKeyParts(dateKey);
  const startValue = Date.UTC(start.year, start.month - 1, start.day);
  const targetValue = Date.UTC(target.year, target.month - 1, target.day);
  if (targetValue < startValue) return false;
  if (event.repeatUnit === 'none' || event.repeatInterval < 1) return targetValue === startValue;

  const dayDifference = Math.round((targetValue - startValue) / 86_400_000);
  if (event.repeatUnit === 'day') return dayDifference % event.repeatInterval === 0;
  if (event.repeatUnit === 'week') return dayDifference % (event.repeatInterval * 7) === 0;
  if (event.repeatUnit === 'month') {
    const monthDifference = (target.year - start.year) * 12 + target.month - start.month;
    return target.day === start.day && monthDifference % event.repeatInterval === 0;
  }
  return target.month === start.month
    && target.day === start.day
    && (target.year - start.year) % event.repeatInterval === 0;
}

function eventsForDate(events: CalendarEvent[], date: Date) {
  const dateKey = toDateKey(date);
  return events.filter((event) => eventOccursOn(event, dateKey));
}

function repeatLabel(interval: number, unit: RepeatUnit) {
  if (unit === 'none' || interval < 1) return 'Does not repeat';
  if (interval === 1) return `Every ${unit}`;
  return `Every ${interval} ${unit}s`;
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
    location: '',
    notes: '',
    repeatInterval: 0,
    repeatUnit: 'none',
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
    location: event.location ?? '',
    notes: event.notes ?? '',
    repeatInterval: event.repeat_interval ?? 0,
    repeatUnit: event.repeat_unit ?? 'none',
  };
}

function CalendarHeader({ viewMode, anchorDate, activeIds, onViewModeChange, onToggleFamily, onSelectMonth, onSelectYear, onToday }: {
  viewMode: CalendarViewMode;
  anchorDate: Date;
  activeIds: Set<string>;
  onViewModeChange: (mode: CalendarViewMode) => void;
  onToggleFamily: (id: string) => void;
  onSelectMonth: (month: number) => void;
  onSelectYear: (year: number) => void;
  onToday: () => void;
}) {
  const [openPicker, setOpenPicker] = useState<'view' | 'month' | 'year' | null>(null);
  const headerRef = useRef<HTMLElement>(null);
  const selectedYear = anchorDate.getFullYear();
  const yearOptions = Array.from({ length: 11 }, (_, index) => selectedYear - 5 + index);

  useEffect(() => {
    if (!openPicker) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!headerRef.current?.contains(event.target as Node)) setOpenPicker(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenPicker(null);
    };
    window.addEventListener('pointerdown', closeOnOutsideClick);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', closeOnOutsideClick);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [openPicker]);

  return (
    <header className="topbar" ref={headerRef}>
      <div className="view-menu">
        <button
          type="button"
          className="menu-button"
          aria-label="Choose calendar view"
          aria-haspopup="menu"
          aria-expanded={openPicker === 'view'}
          onClick={() => setOpenPicker((open) => open === 'view' ? null : 'view')}
        >
          <span className="hamburger-icon" aria-hidden="true"><i /><i /><i /></span>
        </button>
        {openPicker === 'view' && (
          <div className="view-dropdown" role="menu" aria-label="Calendar views">
            <p>Calendar view</p>
            {VIEW_OPTIONS.map((option) => (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={viewMode === option.id}
                className={viewMode === option.id ? 'active' : ''}
                onClick={() => { onViewModeChange(option.id); setOpenPicker(null); }}
                key={option.id}
              >
                <span>{option.label}</span>
                <i aria-hidden="true">{viewMode === option.id ? '✓' : ''}</i>
              </button>
            ))}
          </div>
        )}
      </div>
      <button type="button" className="today-button" onClick={onToday} aria-label="Go to today">
        Today
      </button>
      <div className="header-date-selectors">
        <div className="month-selector">
          <button
            type="button"
            className="header-month"
            aria-label={`Choose month, currently ${MONTHS[anchorDate.getMonth()]}`}
            aria-haspopup="menu"
            aria-expanded={openPicker === 'month'}
            onClick={() => setOpenPicker((open) => open === 'month' ? null : 'month')}
          >
            {MONTHS[anchorDate.getMonth()]}
          </button>
          {openPicker === 'month' && (
            <div className="month-picker" role="menu" aria-label="Choose month">
              {MONTHS.map((month, index) => (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={anchorDate.getMonth() === index}
                  className={anchorDate.getMonth() === index ? 'active' : ''}
                  onClick={() => { onSelectMonth(index); setOpenPicker(null); }}
                  key={month}
                >
                  {month}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="year-selector">
          <button
            type="button"
            className="header-year"
            aria-label={`Choose year, currently ${selectedYear}`}
            aria-haspopup="menu"
            aria-expanded={openPicker === 'year'}
            onClick={() => setOpenPicker((open) => open === 'year' ? null : 'year')}
          >
            {selectedYear}
          </button>
          {openPicker === 'year' && (
            <div className="year-picker" role="menu" aria-label="Choose year">
              {yearOptions.map((year) => (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={selectedYear === year}
                  className={selectedYear === year ? 'active' : ''}
                  onClick={() => { onSelectYear(year); setOpenPicker(null); }}
                  key={year}
                >
                  {year}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <FamilyLegend activeIds={activeIds} onToggle={onToggleFamily} />
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
            className={`family-filter ${active ? 'active' : 'inactive'}`}
            style={{ '--member-color': member.color, '--member-tint': member.tint } as React.CSSProperties}
            aria-pressed={active}
            aria-label={`${active ? 'Hide' : 'Show'} ${member.name}'s events`}
            onClick={() => onToggle(member.id)}
            key={member.id}
          >
            <span className="family-avatar" style={{ backgroundColor: active ? member.color : undefined }}>{member.initial}</span>
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

function CalendarEventCard({ event, activeIds, onOpen, hourHeight }: {
  event: CalendarEvent;
  activeIds: Set<string>;
  onOpen: (event: CalendarEvent) => void;
  hourHeight: number;
}) {
  const participants = event.participantIds.map((id) => FAMILY.find((member) => member.id === id)).filter(Boolean) as FamilyMember[];
  const single = participants.length === 1 ? participants[0] : null;
  const visible = event.participantIds.some((id) => activeIds.has(id));
  const start = timeToMinutes(event.startTime);
  const duration = Math.max(timeToMinutes(event.endTime) - start, 30);
  const top = Math.max(0, ((start - 60) / 60) * hourHeight);
  const height = Math.max(28, (duration / 60) * hourHeight - 2);

  return (
    <button
      className={`calendar-event compact-event ${single ? 'single-person' : 'multi-person'} ${visible ? '' : 'filtered'}`}
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
      <span className="event-participants" aria-hidden="true">
        {participants.map((person) => <i key={person.id} style={{ backgroundColor: person.color }} />)}
      </span>
      <strong>{event.title}</strong>
    </button>
  );
}

function DayColumn({ date, events, activeIds, onOpenEvent, onEmptySlot, hourHeight }: {
  date: Date;
  events: CalendarEvent[];
  activeIds: Set<string>;
  onOpenEvent: (event: CalendarEvent) => void;
  onEmptySlot: (date: Date, hour: number) => void;
  hourHeight: number;
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
        <CalendarEventCard event={event} activeIds={activeIds} onOpen={onOpenEvent} hourHeight={hourHeight} key={event.id} />
      ))}
    </div>
  );
}

function TimelineView({ mode, days, events, activeIds, scrollRef, onOpenEvent, onEmptySlot, onPointerDown, onPointerUp, onPointerCancel, onWheel, onClickCapture }: {
  mode: 'day' | 'three-day';
  days: Date[];
  events: CalendarEvent[];
  activeIds: Set<string>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onOpenEvent: (event: CalendarEvent) => void;
  onEmptySlot: (date: Date, hour: number) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: () => void;
  onWheel: (event: ReactWheelEvent<HTMLDivElement>) => void;
  onClickCapture: (event: React.MouseEvent<HTMLDivElement>) => void;
}) {
  const todayKey = toDateKey(new Date());
  const hourHeight = HOUR_HEIGHT[mode];
  return (
    <section className={`calendar-card timeline-card ${mode === 'day' ? 'day-view' : 'three-day-view'}`} aria-label={`${mode === 'day' ? 'Day' : '3 day'} family calendar`}>
      <div
        className="calendar-scroll"
        ref={scrollRef}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onWheel={onWheel}
        onClickCapture={onClickCapture}
      >
        <div className="date-header timeline-columns" style={{ '--visible-days': days.length } as React.CSSProperties}>
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
        <div className="calendar-grid timeline-columns" style={{ '--visible-days': days.length, '--hour-height': `${hourHeight}px` } as React.CSSProperties}>
          <TimeColumn />
          {days.map((date) => (
            <DayColumn
              date={date}
              events={eventsForDate(events, date)}
              activeIds={activeIds}
              onOpenEvent={onOpenEvent}
              onEmptySlot={onEmptySlot}
              hourHeight={hourHeight}
              key={toDateKey(date)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function MonthEvent({ event, activeIds, onOpen }: { event: CalendarEvent; activeIds: Set<string>; onOpen: (event: CalendarEvent) => void }) {
  const participants = event.participantIds.map((id) => FAMILY.find((member) => member.id === id)).filter(Boolean) as FamilyMember[];
  const single = participants.length === 1 ? participants[0] : null;
  const visible = event.participantIds.some((id) => activeIds.has(id));
  return (
    <button
      type="button"
      className={`month-event ${single ? 'single-person' : 'multi-person'} ${visible ? '' : 'filtered'}`}
      style={{
        '--event-color': single?.color ?? '#B8BBC1',
        '--event-tint': single?.tint ?? '#F4F4F2',
        '--event-ink': single?.ink ?? '#30343B',
      } as React.CSSProperties}
      onClick={() => onOpen(event)}
      title={`${formatTime(event.startTime)} · ${event.title} · ${participants.map((person) => person.name).join(' + ')}`}
    >
      {!single && <span className="event-dots" aria-hidden="true">{participants.map((person) => <i key={person.id} style={{ backgroundColor: person.color }} />)}</span>}
      <span>{event.title}</span>
    </button>
  );
}

function MonthView({ anchorDate, events, activeIds, onPrevious, onNext, onOpenEvent, onEmptyDate }: {
  anchorDate: Date;
  events: CalendarEvent[];
  activeIds: Set<string>;
  onPrevious: () => void;
  onNext: () => void;
  onOpenEvent: (event: CalendarEvent) => void;
  onEmptyDate: (date: Date) => void;
}) {
  const firstOfMonth = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1, 12);
  const gridStart = addDays(firstOfMonth, -firstOfMonth.getDay());
  const daysInMonth = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 0).getDate();
  const cellCount = firstOfMonth.getDay() + daysInMonth <= 35 ? 35 : 42;
  const gridDays = Array.from({ length: cellCount }, (_, index) => addDays(gridStart, index));
  const todayKey = toDateKey(new Date());

  return (
    <section className="calendar-card month-card" aria-label="Month family calendar">
      <div className="month-navigation">
        <button type="button" aria-label="Previous month" onClick={onPrevious}>‹</button>
        <h2>{anchorDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h2>
        <button type="button" aria-label="Next month" onClick={onNext}>›</button>
      </div>
      <div className="month-weekdays" aria-hidden="true">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}
      </div>
      <div className="month-grid">
        {gridDays.map((date) => {
          const dateKey = toDateKey(date);
          const inMonth = date.getMonth() === anchorDate.getMonth();
          const dayEvents = eventsForDate(events, date);
          return (
            <div className={`month-day ${inMonth ? '' : 'outside-month'} ${dateKey === todayKey ? 'is-today' : ''}`} key={dateKey}>
              <button
                type="button"
                className="month-add-target"
                aria-label={`Add event on ${date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`}
                onClick={() => onEmptyDate(date)}
              >
                <span>{date.getDate()}</span>
              </button>
              <div className="month-events">
                {dayEvents.map((event) => <MonthEvent event={event} activeIds={activeIds} onOpen={onOpenEvent} key={event.id} />)}
              </div>
            </div>
          );
        })}
      </div>
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
  const [repeatMenuOpen, setRepeatMenuOpen] = useState(false);
  const [customRepeatOpen, setCustomRepeatOpen] = useState(false);
  const [customInterval, setCustomInterval] = useState(Math.max(1, draft.repeatInterval || 1));
  const [customUnit, setCustomUnit] = useState<Exclude<RepeatUnit, 'none'>>(draft.repeatUnit === 'none' ? 'day' : draft.repeatUnit);
  const repeatControlRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!repeatMenuOpen && !customRepeatOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!repeatControlRef.current?.contains(event.target as Node)) {
        setRepeatMenuOpen(false);
        setCustomRepeatOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setRepeatMenuOpen(false);
        setCustomRepeatOpen(false);
      }
    };
    window.addEventListener('pointerdown', closeOnOutsideClick);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', closeOnOutsideClick);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [repeatMenuOpen, customRepeatOpen]);

  const toggleParticipant = (id: string) => {
    const participantIds = draft.participantIds.includes(id)
      ? draft.participantIds.filter((participantId) => participantId !== id)
      : [...draft.participantIds, id];
    onChange({ ...draft, participantIds });
  };

  const chooseRepeat = (interval: number, unit: RepeatUnit) => {
    onChange({ ...draft, repeatInterval: interval, repeatUnit: unit });
    setRepeatMenuOpen(false);
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
              <input type="time" min="01:00" max="23:00" step="60" required value={draft.startTime} onChange={(event) => onChange({ ...draft, startTime: event.target.value })} />
            </label>
            <label className="field">
              <span>End time</span>
              <input type="time" min="01:01" max="23:59" step="60" required value={draft.endTime} onChange={(event) => onChange({ ...draft, endTime: event.target.value })} />
            </label>
          </div>
          <div className="repeat-row">
            <div className="repeat-control" ref={repeatControlRef}>
              <button
                type="button"
                className="repeat-trigger"
                aria-haspopup="menu"
                aria-expanded={repeatMenuOpen}
                onClick={() => { setRepeatMenuOpen((open) => !open); setCustomRepeatOpen(false); }}
              >
                <span>{repeatLabel(draft.repeatInterval, draft.repeatUnit)}</span>
                <i aria-hidden="true">⌄</i>
              </button>
              {repeatMenuOpen && (
                <div className="repeat-dropdown" role="menu" aria-label="Repeat event">
                  {REPEAT_OPTIONS.map((option) => {
                    const active = draft.repeatInterval === option.interval && draft.repeatUnit === option.unit;
                    return (
                      <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={active}
                        className={active ? 'active' : ''}
                        onClick={() => chooseRepeat(option.interval, option.unit)}
                        key={option.label}
                      >
                        <span>{option.label}</span>
                        <i aria-hidden="true">{active ? '✓' : ''}</i>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { setRepeatMenuOpen(false); setCustomRepeatOpen(true); }}
                  >
                    <span>Custom…</span>
                    <i aria-hidden="true">›</i>
                  </button>
                </div>
              )}
              {customRepeatOpen && (
                <div className="custom-repeat-picker" role="dialog" aria-label="Custom repeat interval">
                  <p>Every</p>
                  <div className="custom-repeat-columns">
                    <label>
                      <span className="sr-only">Repeat interval</span>
                      <select size={5} value={customInterval} onChange={(event) => setCustomInterval(Number(event.target.value))}>
                        {Array.from({ length: 99 }, (_, index) => index + 1).map((value) => <option value={value} key={value}>{value}</option>)}
                      </select>
                    </label>
                    <label>
                      <span className="sr-only">Repeat unit</span>
                      <select size={4} value={customUnit} onChange={(event) => setCustomUnit(event.target.value as Exclude<RepeatUnit, 'none'>)}>
                        <option value="day">days</option>
                        <option value="week">weeks</option>
                        <option value="month">months</option>
                        <option value="year">years</option>
                      </select>
                    </label>
                  </div>
                  <button
                    type="button"
                    className="confirm-repeat"
                    aria-label={`Repeat every ${customInterval} ${customUnit}${customInterval === 1 ? '' : 's'}`}
                    onClick={() => {
                      onChange({ ...draft, repeatInterval: customInterval, repeatUnit: customUnit });
                      setCustomRepeatOpen(false);
                    }}
                  >
                    ✓
                  </button>
                </div>
              )}
            </div>
          </div>
          <label className="field field-full location-field">
            <span className="sr-only">Location</span>
            <input maxLength={180} value={draft.location} placeholder="Add location" onChange={(event) => onChange({ ...draft, location: event.target.value })} />
          </label>
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
  const [viewMode, setViewMode] = useState<CalendarViewMode>('three-day');
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
  const swipeRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const suppressClickUntilRef = useRef(0);
  const lastWheelNavigationRef = useRef(0);
  const days = useMemo(
    () => viewMode === 'day' ? [anchorDate] : [anchorDate, addDays(anchorDate, 1), addDays(anchorDate, 2)],
    [anchorDate, viewMode],
  );
  const accountEmail = session?.user.email?.toLowerCase() ?? '';
  const account = ALLOWED_ACCOUNTS[accountEmail];

  const loadEvents = useCallback(async () => {
    if (!supabase) return;
    setEventsLoading(true);
    const { data, error } = await supabase
      .from('calendar_events')
      .select(DATABASE_EVENT_FIELDS)
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

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || viewMode === 'month') return;
    requestAnimationFrame(() => {
      scroller.scrollTop = 4 * HOUR_HEIGHT[viewMode];
    });
  }, [session, viewMode]);

  useEffect(() => {
    if (!draft) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setDraft(null); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [draft]);

  const moveCalendar = (direction: -1 | 1) => {
    setAnchorDate((current) => {
      if (viewMode === 'month') return addMonths(current, direction);
      return addDays(current, direction * (viewMode === 'three-day' ? 3 : 1));
    });
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    swipeRef.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    event.currentTarget.classList.add('is-dragging');
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = swipeRef.current;
    swipeRef.current = null;
    event.currentTarget.classList.remove('is-dragging');
    if (!start || start.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.abs(deltaX) < 48 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.2) return;
    suppressClickUntilRef.current = Date.now() + 350;
    moveCalendar(deltaX < 0 ? 1 : -1);
  };

  const handlePointerCancel = () => {
    swipeRef.current = null;
    scrollRef.current?.classList.remove('is-dragging');
  };

  const handleTimelineWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY) || Math.abs(event.deltaX) < 20) return;
    event.preventDefault();
    const now = Date.now();
    if (now - lastWheelNavigationRef.current < 450) return;
    lastWheelNavigationRef.current = now;
    moveCalendar(event.deltaX > 0 ? 1 : -1);
  };

  const handleTimelineClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (Date.now() < suppressClickUntilRef.current) {
      event.preventDefault();
      event.stopPropagation();
    }
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
      location: draft.location.trim(),
      notes: draft.notes.trim(),
      repeat_interval: draft.repeatInterval,
      repeat_unit: draft.repeatUnit,
    };
    const query = draft.id
      ? supabase.from('calendar_events').update(payload).eq('id', draft.id)
      : supabase.from('calendar_events').insert(payload);
    const { data, error } = await query
      .select(DATABASE_EVENT_FIELDS)
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
        viewMode={viewMode}
        anchorDate={anchorDate}
        activeIds={activeIds}
        onViewModeChange={setViewMode}
        onToggleFamily={toggleFilter}
        onSelectMonth={(month) => setAnchorDate((current) => new Date(current.getFullYear(), month, 1, 12))}
        onSelectYear={(year) => setAnchorDate(new Date(year, 0, 1, 12))}
        onToday={() => {
          const currentDate = new Date();
          currentDate.setHours(12, 0, 0, 0);
          setAnchorDate(currentDate);
        }}
      />
      {(dataError || (eventsLoading && events.length === 0)) && (
        <div className={`sync-banner ${dataError ? 'error' : ''}`} role="status">
          <span>{dataError || 'Syncing the family schedule…'}</span>
          {dataError && <button type="button" onClick={() => { void loadEvents(); }}>Try again</button>}
        </div>
      )}
      {viewMode === 'month' ? (
        <MonthView
          anchorDate={anchorDate}
          events={events}
          activeIds={activeIds}
          onPrevious={() => moveCalendar(-1)}
          onNext={() => moveCalendar(1)}
          onOpenEvent={(event) => { setFormError(''); setDraft({ ...event }); }}
          onEmptyDate={(date) => openEmptySlot(date, 9)}
        />
      ) : (
        <TimelineView
          mode={viewMode}
          days={days}
          events={events}
          activeIds={activeIds}
          scrollRef={scrollRef}
          onOpenEvent={(event) => { setFormError(''); setDraft({ ...event }); }}
          onEmptySlot={openEmptySlot}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onWheel={handleTimelineWheel}
          onClickCapture={handleTimelineClickCapture}
        />
      )}
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
