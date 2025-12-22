/**
 * Calendar Connector
 *
 * Provides calendar awareness for the Active Operator system.
 * Parses ICS/iCal files and tracks upcoming events for focus window triggers.
 *
 * Part of Phase 3: Massive Greg-Centric Grounding
 */

import * as fs from 'fs';
import * as path from 'path';
import ical from 'node-ical';
import { getProfilePaths } from '../paths.js';
import { audit } from '../audit.js';
import { captureEvent } from '../memory.js';

// ============================================================================
// Types
// ============================================================================

export interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  location?: string;
  start: Date;
  end: Date;
  allDay: boolean;
  recurring: boolean;
  attendees?: string[];
  organizer?: string;
  status?: 'confirmed' | 'tentative' | 'cancelled';
  categories?: string[];
  url?: string;
}

export interface CalendarSource {
  id: string;
  name: string;
  type: 'file' | 'url';
  path: string;
  color?: string;
  enabled: boolean;
  lastSync?: string;
}

export interface CalendarConfig {
  sources: CalendarSource[];
  syncIntervalMinutes: number;
  focusWindowMinutes: number; // How far ahead to look for focus window
  ingestEventsAsMemories: boolean;
}

export interface UpcomingEvent extends CalendarEvent {
  minutesUntilStart: number;
  isNow: boolean;
  source: string;
}

export interface FocusWindow {
  active: boolean;
  currentEvent?: UpcomingEvent;
  nextEvent?: UpcomingEvent;
  minutesUntilNextEvent?: number;
  recommendation: string;
}

// ============================================================================
// Default Config
// ============================================================================

const DEFAULT_CONFIG: CalendarConfig = {
  sources: [],
  syncIntervalMinutes: 15,
  focusWindowMinutes: 60,
  ingestEventsAsMemories: false,
};

// ============================================================================
// Config Management
// ============================================================================

/**
 * Load calendar configuration for a user.
 */
export function loadCalendarConfig(username: string): CalendarConfig {
  const profilePaths = getProfilePaths(username);
  const configPath = path.join(profilePaths.etc, 'calendar.json');

  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(content) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Save calendar configuration for a user.
 */
export function saveCalendarConfig(username: string, config: CalendarConfig): void {
  const profilePaths = getProfilePaths(username);
  const configPath = path.join(profilePaths.etc, 'calendar.json');

  if (!fs.existsSync(profilePaths.etc)) {
    fs.mkdirSync(profilePaths.etc, { recursive: true });
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

/**
 * Add a calendar source.
 */
export function addCalendarSource(
  username: string,
  source: Omit<CalendarSource, 'id'>
): CalendarSource {
  const config = loadCalendarConfig(username);
  const newSource: CalendarSource = {
    ...source,
    id: `cal-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
  };

  config.sources.push(newSource);
  saveCalendarConfig(username, config);

  audit({
    category: 'data_change',
    level: 'info',
    event: 'calendar_source_added',
    actor: username,
    details: { sourceId: newSource.id, name: newSource.name, type: newSource.type },
  });

  return newSource;
}

/**
 * Remove a calendar source.
 */
export function removeCalendarSource(username: string, sourceId: string): boolean {
  const config = loadCalendarConfig(username);
  const index = config.sources.findIndex((s) => s.id === sourceId);

  if (index === -1) {
    return false;
  }

  config.sources.splice(index, 1);
  saveCalendarConfig(username, config);

  audit({
    category: 'data_change',
    level: 'info',
    event: 'calendar_source_removed',
    actor: username,
    details: { sourceId },
  });

  return true;
}

// ============================================================================
// ICS Parsing
// ============================================================================

/**
 * Parse an ICS file and extract events.
 */
export async function parseIcsFile(filepath: string): Promise<CalendarEvent[]> {
  if (!fs.existsSync(filepath)) {
    throw new Error(`Calendar file not found: ${filepath}`);
  }

  const events: CalendarEvent[] = [];
  const data = await ical.parseFile(filepath);

  for (const key in data) {
    const component = data[key];
    if (component.type !== 'VEVENT') continue;

    const event = component as ical.VEvent;

    // Skip events without start times
    if (!event.start) continue;

    const startDate = event.start instanceof Date ? event.start : new Date(event.start);
    const endDate = event.end
      ? event.end instanceof Date
        ? event.end
        : new Date(event.end)
      : new Date(startDate.getTime() + 60 * 60 * 1000); // Default 1 hour

    const calEvent: CalendarEvent = {
      id: event.uid || key,
      title: event.summary || 'Untitled Event',
      description: event.description,
      location: event.location,
      start: startDate,
      end: endDate,
      allDay: isAllDayEvent(event),
      recurring: !!event.rrule,
      status: parseStatus(event.status),
      categories: parseCategories((event as any).categories),
      url: event.url,
    };

    // Parse attendees
    if (event.attendee) {
      calEvent.attendees = parseAttendees(event.attendee);
    }

    // Parse organizer
    if (event.organizer) {
      calEvent.organizer = parseOrganizer(event.organizer);
    }

    events.push(calEvent);
  }

  return events;
}

/**
 * Parse an ICS from URL.
 */
export async function parseIcsUrl(url: string): Promise<CalendarEvent[]> {
  const events: CalendarEvent[] = [];
  const data = await ical.fromURL(url);

  for (const key in data) {
    const component = data[key];
    if (component.type !== 'VEVENT') continue;

    const event = component as ical.VEvent;

    if (!event.start) continue;

    const startDate = event.start instanceof Date ? event.start : new Date(event.start);
    const endDate = event.end
      ? event.end instanceof Date
        ? event.end
        : new Date(event.end)
      : new Date(startDate.getTime() + 60 * 60 * 1000);

    const calEvent: CalendarEvent = {
      id: event.uid || key,
      title: event.summary || 'Untitled Event',
      description: event.description,
      location: event.location,
      start: startDate,
      end: endDate,
      allDay: isAllDayEvent(event),
      recurring: !!event.rrule,
      status: parseStatus(event.status),
      categories: parseCategories((event as any).categories),
      url: event.url,
    };

    if (event.attendee) {
      calEvent.attendees = parseAttendees(event.attendee);
    }

    if (event.organizer) {
      calEvent.organizer = parseOrganizer(event.organizer);
    }

    events.push(calEvent);
  }

  return events;
}

// ============================================================================
// Parsing Helpers
// ============================================================================

function isAllDayEvent(event: ical.VEvent): boolean {
  // All-day events typically have date-only start/end
  if (event.datetype === 'date') return true;
  if (!event.start || !event.end) return false;

  const start = event.start instanceof Date ? event.start : new Date(event.start);
  const end = event.end instanceof Date ? event.end : new Date(event.end);

  // Check if it spans exactly 24 hours and starts at midnight
  const duration = end.getTime() - start.getTime();
  return (
    start.getHours() === 0 &&
    start.getMinutes() === 0 &&
    duration >= 24 * 60 * 60 * 1000
  );
}

function parseStatus(status?: string): 'confirmed' | 'tentative' | 'cancelled' | undefined {
  if (!status) return undefined;
  const normalized = status.toUpperCase();
  if (normalized === 'CONFIRMED') return 'confirmed';
  if (normalized === 'TENTATIVE') return 'tentative';
  if (normalized === 'CANCELLED') return 'cancelled';
  return undefined;
}

function parseCategories(categories?: unknown): string[] | undefined {
  if (!categories) return undefined;
  if (Array.isArray(categories)) {
    return categories.map(String);
  }
  if (typeof categories === 'string') {
    return categories.split(',').map((c) => c.trim());
  }
  return undefined;
}

function parseAttendees(attendee: unknown): string[] {
  if (!attendee) return [];
  if (Array.isArray(attendee)) {
    return attendee.map((a) => {
      if (typeof a === 'string') return a.replace('mailto:', '');
      if (a && typeof a === 'object' && 'val' in a) {
        return String((a as { val: string }).val).replace('mailto:', '');
      }
      return String(a);
    });
  }
  if (typeof attendee === 'string') {
    return [attendee.replace('mailto:', '')];
  }
  return [];
}

function parseOrganizer(organizer: unknown): string | undefined {
  if (!organizer) return undefined;
  if (typeof organizer === 'string') {
    return organizer.replace('mailto:', '');
  }
  if (organizer && typeof organizer === 'object' && 'val' in organizer) {
    return String((organizer as { val: string }).val).replace('mailto:', '');
  }
  return undefined;
}

// ============================================================================
// Event Queries
// ============================================================================

/**
 * Get all events from all enabled calendar sources.
 */
export async function getAllEvents(username: string): Promise<UpcomingEvent[]> {
  const config = loadCalendarConfig(username);
  const allEvents: UpcomingEvent[] = [];
  const now = new Date();

  for (const source of config.sources) {
    if (!source.enabled) continue;

    try {
      let events: CalendarEvent[];

      if (source.type === 'file') {
        events = await parseIcsFile(source.path);
      } else {
        events = await parseIcsUrl(source.path);
      }

      for (const event of events) {
        const minutesUntilStart = (event.start.getTime() - now.getTime()) / (1000 * 60);
        const isNow = now >= event.start && now <= event.end;

        allEvents.push({
          ...event,
          minutesUntilStart,
          isNow,
          source: source.name,
        });
      }
    } catch (error) {
      console.warn(`[calendar] Failed to parse source ${source.name}:`, error);
    }
  }

  // Sort by start time
  allEvents.sort((a, b) => a.start.getTime() - b.start.getTime());

  return allEvents;
}

/**
 * Get upcoming events within a time window.
 */
export async function getUpcomingEvents(
  username: string,
  minutesAhead: number = 60
): Promise<UpcomingEvent[]> {
  const allEvents = await getAllEvents(username);
  const now = new Date();
  const windowEnd = new Date(now.getTime() + minutesAhead * 60 * 1000);

  return allEvents.filter((event) => {
    // Include events happening now or starting within the window
    return event.isNow || (event.start >= now && event.start <= windowEnd);
  });
}

/**
 * Get the current event (if any).
 */
export async function getCurrentEvent(username: string): Promise<UpcomingEvent | null> {
  const allEvents = await getAllEvents(username);
  return allEvents.find((e) => e.isNow) || null;
}

/**
 * Get the next upcoming event.
 */
export async function getNextEvent(username: string): Promise<UpcomingEvent | null> {
  const allEvents = await getAllEvents(username);
  const now = new Date();
  return allEvents.find((e) => e.start > now) || null;
}

// ============================================================================
// Focus Window
// ============================================================================

/**
 * Determine if user is in a focus window based on calendar.
 * A focus window is when:
 * - Currently in an event (meeting in progress)
 * - An event starts soon (preparing for meeting)
 */
export async function getFocusWindow(username: string): Promise<FocusWindow> {
  const config = loadCalendarConfig(username);
  const current = await getCurrentEvent(username);
  const next = await getNextEvent(username);

  // Currently in an event
  if (current) {
    return {
      active: true,
      currentEvent: current,
      nextEvent: next || undefined,
      minutesUntilNextEvent: next?.minutesUntilStart,
      recommendation: `In "${current.title}" - avoid interruptions`,
    };
  }

  // Event starting soon
  if (next && next.minutesUntilStart <= config.focusWindowMinutes) {
    return {
      active: true,
      nextEvent: next,
      minutesUntilNextEvent: next.minutesUntilStart,
      recommendation: `"${next.title}" starts in ${Math.round(next.minutesUntilStart)} minutes - prepare and avoid starting new tasks`,
    };
  }

  // No focus window
  return {
    active: false,
    nextEvent: next || undefined,
    minutesUntilNextEvent: next?.minutesUntilStart,
    recommendation: next
      ? `Free until "${next.title}" in ${Math.round(next.minutesUntilStart)} minutes`
      : 'No upcoming events - good time for deep work',
  };
}

// ============================================================================
// Memory Integration
// ============================================================================

/**
 * Ingest calendar events as memories for context grounding.
 */
export async function ingestCalendarEvents(
  username: string,
  events: CalendarEvent[],
  source: string
): Promise<string[]> {
  const eventIds: string[] = [];

  for (const event of events) {
    const content = formatEventAsContent(event);
    const tags = generateEventTags(event);

    const eventId = captureEvent(content, {
      type: 'observation',
      tags,
      metadata: {
        calendar: {
          eventId: event.id,
          title: event.title,
          start: event.start.toISOString(),
          end: event.end.toISOString(),
          location: event.location,
        },
        consent: true,
        provenance: 'calendar-sync',
        source: `calendar:${source}`,
      },
    });

    eventIds.push(eventId);
  }

  audit({
    category: 'data_change',
    level: 'info',
    event: 'calendar_events_ingested',
    actor: 'calendar-connector',
    details: {
      username,
      source,
      eventCount: events.length,
    },
  });

  return eventIds;
}

function formatEventAsContent(event: CalendarEvent): string {
  const parts: string[] = [];

  parts.push(`Calendar Event: ${event.title}`);
  parts.push(`When: ${formatEventTime(event)}`);

  if (event.location) {
    parts.push(`Location: ${event.location}`);
  }

  if (event.attendees && event.attendees.length > 0) {
    parts.push(`Attendees: ${event.attendees.join(', ')}`);
  }

  if (event.description) {
    parts.push(`Description: ${event.description}`);
  }

  return parts.join('\n');
}

function formatEventTime(event: CalendarEvent): string {
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: event.allDay ? undefined : 'numeric',
    minute: event.allDay ? undefined : '2-digit',
  };

  if (event.allDay) {
    return `${event.start.toLocaleDateString(undefined, options)} (All Day)`;
  }

  return `${event.start.toLocaleDateString(undefined, options)} - ${event.end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

function generateEventTags(event: CalendarEvent): string[] {
  const tags: string[] = ['calendar', 'event'];

  if (event.allDay) {
    tags.push('all-day');
  }

  if (event.recurring) {
    tags.push('recurring');
  }

  if (event.categories) {
    tags.push(...event.categories.map((c) => c.toLowerCase()));
  }

  // Date-based tags
  const date = event.start;
  tags.push(date.getFullYear().toString());
  tags.push(date.toLocaleString('default', { month: 'long' }).toLowerCase());

  return [...new Set(tags)];
}

// ============================================================================
// Sync
// ============================================================================

/**
 * Sync all calendar sources for a user.
 */
export async function syncCalendars(username: string): Promise<{
  sources: number;
  events: number;
  errors: string[];
}> {
  const config = loadCalendarConfig(username);
  let totalEvents = 0;
  const errors: string[] = [];

  for (const source of config.sources) {
    if (!source.enabled) continue;

    try {
      let events: CalendarEvent[];

      if (source.type === 'file') {
        events = await parseIcsFile(source.path);
      } else {
        events = await parseIcsUrl(source.path);
      }

      // Optionally ingest as memories
      if (config.ingestEventsAsMemories) {
        await ingestCalendarEvents(username, events, source.name);
      }

      totalEvents += events.length;

      // Update last sync time
      source.lastSync = new Date().toISOString();
    } catch (error) {
      errors.push(`${source.name}: ${(error as Error).message}`);
    }
  }

  saveCalendarConfig(username, config);

  return {
    sources: config.sources.filter((s) => s.enabled).length,
    events: totalEvents,
    errors,
  };
}

// ============================================================================
// Export
// ============================================================================

export const calendarConnector = {
  loadCalendarConfig,
  saveCalendarConfig,
  addCalendarSource,
  removeCalendarSource,
  parseIcsFile,
  parseIcsUrl,
  getAllEvents,
  getUpcomingEvents,
  getCurrentEvent,
  getNextEvent,
  getFocusWindow,
  ingestCalendarEvents,
  syncCalendars,
};
