# Web UI Layout Improvement Plan

## Overview

The current web UI layout is not optimized for mobile devices. The sidebars crowd the main content area, making it difficult to use on smaller screens. This plan outlines the steps to create a more responsive and user-friendly layout using Tailwind CSS.

## Plan

1.  **Mobile-First Approach:** The layout will be modified to be mobile-first. By default, both the left and right sidebars will be hidden on mobile devices, providing maximum space for the main chat interface.

2.  **Accessible Sidebar Toggles:** The hamburger icons in the header will be used to toggle the visibility of the sidebars on mobile devices. This will allow users to easily access the sidebars when needed, without cluttering the interface.

3.  **Responsive Layout for Desktops:** For larger screens (desktops and tablets), the sidebars will be visible by default, ensuring that the layout adapts to the available screen space.

4.  **Code Refactoring:** The existing CSS in `ChatLayout.svelte` will be refactored to use Tailwind CSS classes. This will make the code more consistent and easier to maintain in the future.

## Implementation Details

*   **File to modify:** `apps/site/src/components/ChatLayout.svelte`
*   **CSS to refactor:** The `<style>` block in `ChatLayout.svelte` will be replaced with Tailwind CSS classes.
*   **Responsive Prefixes:** Tailwind's responsive prefixes (e.g., `md:`, `lg:`) will be used to apply different styles for different screen sizes.
*   **Sidebar Visibility:** The `leftSidebarOpen` and `rightSidebarOpen` variables will be used to control the visibility of the sidebars. The default values will be changed to `false` on mobile and `true` on desktop.
