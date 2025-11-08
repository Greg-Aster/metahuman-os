# Audit Stream UI Improvements Plan

## Goal
Make the live audit stream readable at-a-glance while still exposing full event data on demand.

## Constraints
- No loss of existing audit detail (must remain inspectable)
- Works in current Svelte UI without heavy dependencies
- Minimal performance impact (stream already high frequency)

## High-Level Approach
1. **Event Normalization Layer**
   - Introduce a stream transformer (client-side) that maps raw JSON events to a standard shape `{ id, time, category, summary, details }`.
   - Additional derived fields: `taskId` (grouping), `type`, `severity`.
2. **Grouped UI**
   - Main list shows one line per `taskId` (e.g., operator iteration, agent cycle, file write).
   - Each group displays summary, status icon, most recent event timestamp, and count of sub-events.
   - Clicking expands an accordion containing chronological raw entries.
3. **Detail Drawer**
   - Optional “View details” button opens side drawer/ modal with full JSON for the selected event, including copy-to-clipboard.
4. **Filters & Search**
   - Add filtering chips (severity, category, actor) plus a text search that matches summary/task IDs.
5. **Performance Considerations**
   - Keep only N groups in-memory (e.g., last 200); older ones trimmed but can be reloaded via “Load older logs”.
   - Virtualized list for expanded view if needed.

## Implementation Steps
1. **Data Layer**
   - Update audit stream handler (`apps/site/src/components/CenterContent.svelte` or dedicated store) to normalize incoming events.
   - Define `TaskGroup` interface and grouping logic keyed by `event.details.taskId || event.event`.
   - Maintain two stores: `taskGroups` (summary) and `selectedGroup` (detail view).

2. **UI Components**
   - Create `AuditStream.svelte` component with:
     - Summary list (accordion)
     - Detail drawer modal
     - Filter/search bar
   - Reuse existing styles but add severity colors (info, warn, error).

3. **Interactivity**
   - Clicking summary toggles accordion expansion (Svelte `transition:slide`).
   - “View JSON” button opens drawer showing formatted JSON with syntax highlighting (use `<pre>` + `JSON.stringify(..., null, 2)`).
   - Filters update computed store for displayed groups.

4. **Testing/Validation**
   - Simulate high-frequency stream by replaying `logs/run/latest.ndjson` through the component.
   - Ensure collapsed view updates efficiently and no console errors.

## Follow-Up Enhancements
- Persist filter selections in `localStorage`.
- Allow pinning a group to keep it expanded even as new events arrive.
- Add export button to download group events as NDJSON.

