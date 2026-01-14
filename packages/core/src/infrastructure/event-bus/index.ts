/**
 * Event Bus Infrastructure
 *
 * Centralized event aggregation for MetaHuman services.
 *
 * Usage:
 *   import { eventBus, EventTypes, createEvent } from './infrastructure/event-bus/index.js';
 *
 *   // Publish an event
 *   eventBus.emit('core', EventTypes.CORE_STARTED, { version: '1.0.0' });
 *
 *   // Or create and publish manually
 *   const event = createEvent('agents', 'agent.completed', { data: { agentId: '123' } });
 *   eventBus.publish(event);
 */

// Schema exports
export type { MetaHumanEvent, EventSource, EventLevel } from './schema.js';
export { EventTypes, generateRequestId, createEvent } from './schema.js';

// Client exports
export { EventBusClient, getEventBus, eventBus } from './client.js';

// Server exports (for standalone server process)
export { EventBusServer } from './server.js';
