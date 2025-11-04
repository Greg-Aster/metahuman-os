# Tailwind Component Classes

This document describes the centralized Tailwind component classes available throughout MetaHuman OS.

## Overview

All shared component styles are defined in `/apps/site/src/styles/tailwind.css` using Tailwind's `@layer components` directive. This provides:

- **Centralized styling** - One place to update styles across all components
- **Dark mode support** - All components automatically support light/dark themes
- **Reusability** - Use the same classes across multiple Svelte components
- **Smaller files** - Component files focus on logic, not styling

## Available Component Classes

### Chat Interface Components

```html
<div class="chat-interface">...</div>           <!-- Main chat container -->
<div class="mode-toggle-container">...</div>    <!-- Mode selection header -->
<div class="mode-toggle">...</div>              <!-- Toggle group -->
<button class="mode-btn" class:active={isActive}>Mode</button>
<button class="clear-btn">Clear</button>

<!-- Messages -->
<div class="messages-container">...</div>
<div class="messages-list">...</div>
<div class="message message-user">...</div>     <!-- User message -->
<div class="message message-assistant">...</div> <!-- Assistant message -->
<div class="message-header">...</div>
<span class="message-role">User</span>
<span class="message-time">12:30</span>
<div class="message-content">...</div>

<!-- Input area -->
<div class="input-container">...</div>
<div class="input-wrapper">...</div>
<div class="input-row">...</div>
<textarea class="chat-input"></textarea>
<div class="input-actions">...</div>
<button class="send-btn">Send</button>
<button class="mic-btn">Mic</button>

<!-- Welcome screen -->
<div class="welcome-screen">...</div>
<div class="welcome-icon">👋</div>
<h1 class="welcome-title">Welcome</h1>
<p class="welcome-subtitle">Start chatting...</p>
<button class="suggestion">Suggestion text</button>

<!-- Typing indicator -->
<div class="typing">
  <div class="typing-dot"></div>
  <div class="typing-dot"></div>
  <div class="typing-dot"></div>
</div>
```

### View Containers

```html
<div class="view-container">...</div>       <!-- Main view wrapper -->
<div class="view-header">...</div>          <!-- View header section -->
<h2 class="view-title">Title</h2>           <!-- View title -->
<p class="view-subtitle">Subtitle</p>       <!-- View subtitle -->
<div class="view-content">...</div>         <!-- Scrollable content area -->
```

### Sidebar Components

```html
<!-- Left sidebar menu -->
<div class="menu">...</div>
<button class="menu-item" class:active={isActive}>
  <span class="menu-icon">🏠</span>
  <div class="menu-text">
    <span class="menu-label">Home</span>
    <span class="menu-description">Dashboard view</span>
  </div>
</button>

<!-- Status widget -->
<div class="status-widget">...</div>
<h3 class="widget-header">System Status</h3>
<div class="status-row">
  <span class="status-label">Model:</span>
  <span class="status-value">phi3:mini</span>
</div>
```

### Tabs

```html
<!-- Memory/episodic style tabs (rounded pills) -->
<div class="tab-group">
  <button class="tab-button" class:active={condition}>Tab 1</button>
  <button class="tab-button active">Tab 2</button>
</div>

<!-- Right sidebar style tabs (bottom border) -->
<div class="tabs">
  <button class="tab" class:active={isActive}>
    <span class="tab-icon">⚙️</span>
    <span class="tab-label">Settings</span>
  </button>
</div>
```

### Cards

```html
<div class="event-card">
  <div class="event-card-header">
    <h3 class="event-card-title">Title</h3>
  </div>
  <div class="event-card-meta">
    <span class="event-card-time">2025-01-01</span>
  </div>
  <div class="event-card-content">
    <p>Content here...</p>
  </div>
</div>
```

### Tags & Badges

```html
<!-- Memory tags -->
<span class="tag">Default tag</span>
<span class="tag-blue">Blue tag</span>
<span class="tag-yellow">Yellow tag</span>
<span class="tag-green">Green tag</span>
<span class="tag-red">Red tag</span>

<!-- Status badges -->
<span class="status-badge">Status</span>
<span class="adapter-badge ok">Ready</span>
<span class="adapter-badge warn">Warning</span>
<span class="adapter-badge info">Info</span>

<!-- Trust level badges -->
<span class="status-badge trust-observe">Observe</span>
<span class="status-badge trust-suggest">Suggest</span>
<span class="status-badge trust-supervised_auto">Supervised</span>
<span class="status-badge trust-bounded_auto">Bounded</span>
```

### Buttons

```html
<button class="btn-validation">Validate</button>
<button class="btn-validation-good">✓</button>
<button class="btn-validation-bad">✗</button>
<button class="btn-expand">Expand</button>
```

### Forms

```html
<div class="form-group">
  <label class="form-label">Label</label>
  <input class="form-input" type="text" />
</div>

<div class="form-group">
  <label class="form-label">Description</label>
  <textarea class="form-textarea"></textarea>
</div>

<button class="form-button">Save</button>
<button class="form-button-secondary">Cancel</button>

<!-- Settings forms -->
<div class="setting-group">
  <label class="setting-label">Setting Name</label>
  <div class="info-grid">
    <div class="info-item">
      <span class="info-key">Key:</span>
      <span class="info-value">Value</span>
    </div>
  </div>
</div>

<!-- Toggle switch -->
<label class="toggle-switch">
  <input type="checkbox" />
  <span class="toggle-slider"></span>
</label>

<!-- Danger zone -->
<div class="danger-zone">
  <button class="danger-button">Delete</button>
</div>
```

### Messages

```html
<div class="message-success">Success message</div>
<div class="message-error">Error message</div>
```

### Empty States

```html
<div class="empty-state">
  <div class="empty-icon">📭</div>
  <div class="empty-title">No items found</div>
  <div class="empty-description">
    Try creating a new item with <code>./bin/mh create</code>
  </div>
</div>
```

### Border Accents

```html
<div class="event-card border-accent-violet">...</div>
<div class="event-card border-accent-blue">...</div>
<div class="event-card border-accent-yellow">...</div>
<div class="event-card border-accent-green">...</div>
```

### Metadata Display

```html
<div class="metadata-grid">
  <span class="metadata-label">ID:</span>
  <span class="metadata-value">12345</span>

  <span class="metadata-label">Status:</span>
  <span class="metadata-value">active</span>
</div>
```

### Utility Classes

```html
<span class="text-mono-sm">Monospace small text</span>
<button class="clickable-reset">Reset button styles</button>

<!-- Custom scrollbars -->
<div class="custom-scrollbar">Scrollable content</div>

<!-- Layout components -->
<span class="mode-label">Mode Name</span>
<button class="mode-menu-trigger">Open Menu</button>
<img class="persona-icon" src="avatar.png" alt="Avatar" />
```

## Usage Examples

### Memory Card

```svelte
<div class="event-card border-accent-violet">
  <div class="event-card-header">
    <h3 class="event-card-title">Memory Title</h3>
    <div class="validation-controls">
      <button class="btn-validation-good">+</button>
      <button class="btn-validation-bad">−</button>
    </div>
  </div>

  <div class="event-card-content">
    <p>Memory content here...</p>
  </div>

  <div class="event-card-meta">
    <span class="event-card-time">{timestamp}</span>
    <div class="flex gap-1">
      <span class="tag">ai</span>
      <span class="tag">memory</span>
    </div>
  </div>
</div>
```

### Tabbed Interface

```svelte
<div class="view-container">
  <div class="view-header">
    <h2 class="view-title">🎤 Voice</h2>
    <p class="view-subtitle">Audio features & settings</p>
  </div>

  <div class="view-content">
    <div class="tab-group">
      <button class="tab-button" class:active={tab==='upload'} on:click={() => tab='upload'}>
        Upload
      </button>
      <button class="tab-button" class:active={tab==='settings'} on:click={() => tab='settings'}>
        Settings
      </button>
    </div>

    {#if tab === 'upload'}
      <!-- Upload content -->
    {:else}
      <!-- Settings content -->
    {/if}
  </div>
</div>
```

### Form

```svelte
<div class="persona-panel">
  <div class="form-group">
    <label class="form-label">Name</label>
    <input class="form-input" type="text" bind:value={name} />
  </div>

  <div class="form-group">
    <label class="form-label">Bio</label>
    <textarea class="form-textarea" bind:value={bio}></textarea>
  </div>

  <div class="flex justify-end gap-2">
    <button class="form-button-secondary">Cancel</button>
    <button class="form-button">Save</button>
  </div>
</div>
```

## Dark Mode

All component classes automatically support dark mode through Tailwind's `dark:` variant. No additional work needed - just apply the class and it works in both themes!

Example:
```css
.event-card {
  @apply p-4 rounded-lg border border-black/10 dark:border-white/10
         bg-white dark:bg-white/5;
}
```

## Extending

To add new component classes, edit `/apps/site/src/styles/tailwind.css`:

```css
@layer components {
  .your-new-component {
    @apply /* your tailwind classes here */;
  }
}
```

Always include dark mode variants for colors, borders, and backgrounds.

## Important Limitation: @apply in Component Styles

**You cannot use `@apply` with custom component classes inside Svelte `<style>` blocks.**

This will cause a build error:
```svelte
<style>
  .my-element {
    @apply event-card;  /* ❌ ERROR - custom class not found */
  }
</style>
```

**Solutions:**

1. **Use the class directly in HTML** (preferred):
```svelte
<div class="event-card">...</div>  <!-- ✅ Works perfectly -->
```

2. **Expand the styles inline** (for component-specific styles):
```svelte
<style>
  .my-element {
    /* ✅ Copy the Tailwind classes directly */
    @apply p-4 rounded-lg border border-black/10 dark:border-white/10
           bg-white dark:bg-white/5;
  }
</style>
```

The global component classes are meant to be used directly in HTML templates, not via `@apply` in component styles.

## Migration Guide

When refactoring old components:

1. Identify repeated style patterns
2. Check if a component class already exists
3. If not, add it to `tailwind.css`
4. Replace `<style>` blocks with class names
5. Test in both light and dark mode

## File Locations

- **Component Classes**: `/apps/site/src/styles/tailwind.css`
- **Tailwind Config**: `/apps/site/tailwind.config.cjs`
- **Example Usage**: `/apps/site/src/components/CenterContent.svelte`
