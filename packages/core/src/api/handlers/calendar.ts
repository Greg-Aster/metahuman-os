/**
 * Calendar API Handler
 *
 * Endpoints for calendar management and focus window queries.
 * GET /api/calendar/events - List upcoming events
 * GET /api/calendar/focus-window - Get current focus window status
 * GET /api/calendar/sources - List calendar sources
 * POST /api/calendar/sources - Add a calendar source
 * DELETE /api/calendar/sources/:id - Remove a calendar source
 * POST /api/calendar/sync - Sync all calendars
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse, errorResponse, badRequestResponse } from '../types.js';
import {
  loadCalendarConfig,
  saveCalendarConfig,
  addCalendarSource,
  removeCalendarSource,
  getUpcomingEvents,
  getFocusWindow,
  syncCalendars,
  type CalendarSource,
} from '../../connectors/calendar-connector.js';
import { audit } from '../../audit.js';

/**
 * GET /api/calendar/events
 * List upcoming events within a time window
 * Query params:
 *   - minutes: How far ahead to look (default 60)
 */
export async function handleGetCalendarEvents(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const minutes = parseInt(req.query?.minutes || '60', 10);
    const events = await getUpcomingEvents(req.user.username, minutes);

    return successResponse({
      success: true,
      events: events.map((e) => ({
        id: e.id,
        title: e.title,
        description: e.description,
        location: e.location,
        start: e.start.toISOString(),
        end: e.end.toISOString(),
        allDay: e.allDay,
        isNow: e.isNow,
        minutesUntilStart: Math.round(e.minutesUntilStart),
        source: e.source,
        attendees: e.attendees,
        status: e.status,
      })),
      count: events.length,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * GET /api/calendar/focus-window
 * Get current focus window status for the Active Operator
 */
export async function handleGetFocusWindow(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const focusWindow = await getFocusWindow(req.user.username);

    return successResponse({
      success: true,
      focusWindow: {
        active: focusWindow.active,
        recommendation: focusWindow.recommendation,
        minutesUntilNextEvent: focusWindow.minutesUntilNextEvent
          ? Math.round(focusWindow.minutesUntilNextEvent)
          : null,
        currentEvent: focusWindow.currentEvent
          ? {
              title: focusWindow.currentEvent.title,
              location: focusWindow.currentEvent.location,
              end: focusWindow.currentEvent.end.toISOString(),
            }
          : null,
        nextEvent: focusWindow.nextEvent
          ? {
              title: focusWindow.nextEvent.title,
              location: focusWindow.nextEvent.location,
              start: focusWindow.nextEvent.start.toISOString(),
              minutesUntilStart: Math.round(focusWindow.nextEvent.minutesUntilStart),
            }
          : null,
      },
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * GET /api/calendar/sources
 * List all calendar sources
 */
export async function handleGetCalendarSources(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const config = loadCalendarConfig(req.user.username);

    return successResponse({
      success: true,
      sources: config.sources,
      syncIntervalMinutes: config.syncIntervalMinutes,
      focusWindowMinutes: config.focusWindowMinutes,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * POST /api/calendar/sources
 * Add a new calendar source
 */
export async function handleAddCalendarSource(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const body = req.body as {
      name: string;
      type: 'file' | 'url';
      path: string;
      color?: string;
      enabled?: boolean;
    };

    if (!body.name) {
      return badRequestResponse('name is required');
    }

    if (!body.type || !['file', 'url'].includes(body.type)) {
      return badRequestResponse('type must be "file" or "url"');
    }

    if (!body.path) {
      return badRequestResponse('path is required');
    }

    const source = addCalendarSource(req.user.username, {
      name: body.name,
      type: body.type,
      path: body.path,
      color: body.color,
      enabled: body.enabled ?? true,
    });

    return successResponse({
      success: true,
      source,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * DELETE /api/calendar/sources/:id
 * Remove a calendar source
 */
export async function handleRemoveCalendarSource(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const sourceId = req.params?.id;

    if (!sourceId) {
      return badRequestResponse('source id is required');
    }

    const success = removeCalendarSource(req.user.username, sourceId);

    if (!success) {
      return errorResponse('Calendar source not found', 404);
    }

    return successResponse({
      success: true,
      message: 'Calendar source removed',
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * PUT /api/calendar/sources/:id
 * Update a calendar source
 */
export async function handleUpdateCalendarSource(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const sourceId = req.params?.id;
    const body = req.body as Partial<CalendarSource>;

    if (!sourceId) {
      return badRequestResponse('source id is required');
    }

    const config = loadCalendarConfig(req.user.username);
    const sourceIndex = config.sources.findIndex((s) => s.id === sourceId);

    if (sourceIndex === -1) {
      return errorResponse('Calendar source not found', 404);
    }

    // Update fields
    if (body.name !== undefined) config.sources[sourceIndex].name = body.name;
    if (body.path !== undefined) config.sources[sourceIndex].path = body.path;
    if (body.color !== undefined) config.sources[sourceIndex].color = body.color;
    if (body.enabled !== undefined) config.sources[sourceIndex].enabled = body.enabled;

    saveCalendarConfig(req.user.username, config);

    audit({
      category: 'data_change',
      level: 'info',
      event: 'calendar_source_updated',
      actor: req.user.username,
      details: { sourceId, updates: body },
    });

    return successResponse({
      success: true,
      source: config.sources[sourceIndex],
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * POST /api/calendar/sync
 * Sync all calendar sources
 */
export async function handleSyncCalendars(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const result = await syncCalendars(req.user.username);

    return successResponse({
      success: true,
      ...result,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * PUT /api/calendar/config
 * Update calendar configuration
 */
export async function handleUpdateCalendarConfig(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const body = req.body as {
      syncIntervalMinutes?: number;
      focusWindowMinutes?: number;
      ingestEventsAsMemories?: boolean;
    };

    const config = loadCalendarConfig(req.user.username);

    if (body.syncIntervalMinutes !== undefined) {
      config.syncIntervalMinutes = body.syncIntervalMinutes;
    }
    if (body.focusWindowMinutes !== undefined) {
      config.focusWindowMinutes = body.focusWindowMinutes;
    }
    if (body.ingestEventsAsMemories !== undefined) {
      config.ingestEventsAsMemories = body.ingestEventsAsMemories;
    }

    saveCalendarConfig(req.user.username, config);

    audit({
      category: 'data_change',
      level: 'info',
      event: 'calendar_config_updated',
      actor: req.user.username,
      details: body,
    });

    return successResponse({
      success: true,
      config: {
        syncIntervalMinutes: config.syncIntervalMinutes,
        focusWindowMinutes: config.focusWindowMinutes,
        ingestEventsAsMemories: config.ingestEventsAsMemories,
      },
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}
