# Phase 4 UI Integration - Manual Test Guide

## Overview

This guide verifies that the UI correctly reflects the security policy state and prevents users from attempting blocked operations.

## Prerequisites

1. Start the dev server: `cd apps/site && pnpm dev`
2. Open browser to `http://localhost:4321`
3. Open browser DevTools console to check for errors

---

## Test 1: Policy Store Initialization

**Goal:** Verify security policy is fetched and stored correctly

**Steps:**
1. Open browser to `http://localhost:4321`
2. Open DevTools Console
3. Check for policy fetch request: Network tab → filter for "/api/security/policy"

**Expected Results:**
- ✓ Policy endpoint is called on page load
- ✓ Response contains policy object with permissions
- ✓ No console errors related to policy fetching

**Verify in Console:**
```javascript
// Should show the current policy
window.localStorage // Policy may be reflected via stores
```

---

## Test 2: Read-Only Banner in Emulation Mode

**Goal:** Verify banner appears when in emulation mode

**Setup:**
```bash
# Switch to emulation mode
curl -X POST http://localhost:4321/api/cognitive-mode \
  -H "Content-Type: application/json" \
  -d '{"mode":"emulation"}'
```

**Steps:**
1. Refresh the page or wait for policy polling (max 30s)
2. Look for amber banner under the header

**Expected Results:**
- ✓ Amber "Read-Only Mode" banner appears
- ✓ Banner shows lock icon
- ✓ Message says "Memory and configuration changes are disabled in emulation mode"
- ✓ Banner suggests switching to dual or agent mode

**Screenshot Area:** Top of page under header

---

## Test 3: Read-Only Banner NOT in Dual Mode

**Goal:** Verify banner does NOT appear in dual mode

**Setup:**
```bash
# Switch to dual mode
curl -X POST http://localhost:4321/api/cognitive-mode \
  -H "Content-Type: application/json" \
  -d '{"mode":"dual"}'
```

**Steps:**
1. Refresh the page or wait for policy polling (max 30s)
2. Look for amber banner under the header

**Expected Results:**
- ✓ No read-only banner visible
- ✓ Only header and mode indicator visible

---

## Test 4: Task Creation Button Disabled in Emulation

**Goal:** Verify "New Task" button is disabled in emulation mode

**Setup:**
1. Ensure system is in emulation mode (from Test 2)
2. Navigate to Tasks view (click "Tasks" in left sidebar)

**Steps:**
1. Look for the "+ New Task" button
2. Try to click it
3. Hover over it to see tooltip

**Expected Results:**
- ✓ "+ New Task" button appears grayed out/disabled
- ✓ Button cannot be clicked
- ✓ Hover tooltip shows: "Task creation disabled in read-only mode"
- ✓ Button has visual disabled state (opacity reduced, no hover effect)

---

## Test 5: Task Creation Button Enabled in Dual Mode

**Goal:** Verify "New Task" button works in dual mode

**Setup:**
1. Switch to dual mode (from Test 3)
2. Navigate to Tasks view

**Steps:**
1. Look for the "+ New Task" button
2. Hover over it
3. Click it

**Expected Results:**
- ✓ Button appears normal (not disabled)
- ✓ Hover tooltip shows: "Create a new task"
- ✓ Clicking opens the new task input form
- ✓ Visual hover effects work (color change, cursor pointer)

---

## Test 6: Operator Button Disabled in Emulation

**Goal:** Verify operator controls are disabled in emulation mode

**Setup:**
1. Ensure system is in emulation mode
2. Go to main chat interface (home page)

**Steps:**
1. Look at the input area bottom toolbar
2. Find the operator icon button (looks like a helmet/operator symbol)
3. Find the YOLO mode button (lightning bolt icon)
4. Hover over each button

**Expected Results:**
- ✓ Operator button appears grayed out/disabled
- ✓ YOLO button appears grayed out/disabled
- ✓ Operator hover tooltip: "Operator disabled in current mode"
- ✓ YOLO hover tooltip: "YOLO mode disabled in current mode"
- ✓ Buttons cannot be clicked
- ✓ No active state changes on click

---

## Test 7: Operator Button Enabled in Dual Mode

**Goal:** Verify operator controls work in dual mode

**Setup:**
1. Switch to dual mode
2. Go to main chat interface

**Steps:**
1. Look at operator buttons in input toolbar
2. Hover over operator button
3. Click operator button
4. Hover over YOLO button

**Expected Results:**
- ✓ Operator button appears normal (not disabled)
- ✓ Operator hover tooltip: "Enable operator mode"
- ✓ Clicking toggles operator mode (button becomes active/highlighted)
- ✓ YOLO button appears normal
- ✓ YOLO hover tooltip: "Enable YOLO mode"
- ✓ Both buttons clickable and functional

---

## Test 8: Real-time Policy Updates

**Goal:** Verify UI updates when mode changes without page refresh

**Setup:**
1. Start in dual mode
2. Keep browser window visible

**Steps:**
1. In a terminal, switch to emulation mode:
   ```bash
   curl -X POST http://localhost:4321/api/cognitive-mode \
     -H "Content-Type: application/json" \
     -d '{"mode":"emulation"}'
   ```
2. Wait up to 30 seconds (policy polling interval)
3. Observe UI changes

**Expected Results:**
- ✓ Read-only banner appears within 30 seconds
- ✓ Operator buttons become disabled
- ✓ Task creation button becomes disabled (if on tasks page)
- ✓ Mode indicator updates to "Emulation"
- ✓ No page refresh required

---

## Test 9: Disabled Button Styles

**Goal:** Verify visual feedback for disabled states

**Setup:**
1. Set to emulation mode
2. Navigate through different views

**Steps:**
1. Check "+ New Task" button
2. Check operator icon buttons
3. Verify cursor changes
4. Check opacity/color changes

**Expected Results:**
- ✓ Disabled buttons have reduced opacity (~0.5-0.6)
- ✓ Cursor shows "not-allowed" or "default" (not "pointer")
- ✓ No hover state transitions on disabled buttons
- ✓ Buttons clearly look "grayed out"
- ✓ Consistent disabled styling across all components

---

## Test 10: Policy Store Error Handling

**Goal:** Verify graceful handling if policy fetch fails

**Setup:**
1. Stop the dev server
2. Keep browser open

**Steps:**
1. Wait for next policy poll (happens every 30s)
2. Check console for errors
3. Restart server
4. Observe recovery

**Expected Results:**
- ✓ Console shows policy fetch error (expected)
- ✓ UI falls back to safe defaults (most restrictive)
- ✓ Read-only banner appears (or stays visible)
- ✓ All write features disabled
- ✓ When server returns, policy refreshes automatically
- ✓ UI recovers without manual refresh

---

## Test 11: Mobile Responsive Behavior

**Goal:** Verify policy UI works on mobile

**Setup:**
1. Open DevTools
2. Toggle device toolbar (mobile emulation)
3. Select iPhone or Android device

**Steps:**
1. Test in emulation mode
2. Check banner visibility
3. Test operator buttons
4. Verify tooltips/titles work on touch

**Expected Results:**
- ✓ Read-only banner is fully visible and readable
- ✓ Banner doesn't overflow or wrap badly
- ✓ Disabled buttons still show disabled state
- ✓ Touch feedback appropriate for disabled buttons
- ✓ All text legible at mobile sizes

---

## Test 12: Cross-Component Consistency

**Goal:** Verify policy state is consistent across all components

**Setup:**
1. Set to emulation mode
2. Navigate through all main views

**Steps:**
1. Check Chat Interface
2. Check Tasks view
3. Check any other views that use policy
4. Verify all show same state

**Expected Results:**
- ✓ All components show read-only state simultaneously
- ✓ No component allows writes while in emulation
- ✓ Banner visible on all pages
- ✓ Consistent disabled states across views

---

## Cleanup

After testing, restore to dual mode:

```bash
curl -X POST http://localhost:4321/api/cognitive-mode \
  -H "Content-Type": application/json" \
  -d '{"mode":"dual"}'
```

---

## Summary Checklist

- [ ] Policy fetched on page load
- [ ] Read-only banner appears in emulation mode
- [ ] Read-only banner hidden in dual mode
- [ ] Task creation button disabled in emulation
- [ ] Task creation button enabled in dual
- [ ] Operator buttons disabled in emulation
- [ ] Operator buttons enabled in dual
- [ ] Real-time updates work (30s polling)
- [ ] Disabled button styles clear and consistent
- [ ] Error handling graceful (safe defaults)
- [ ] Mobile responsive
- [ ] Cross-component consistency

**All tests passing = Phase 4 Complete!** ✅
