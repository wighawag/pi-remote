# Plan: Web Dashboard Redesign — Match site/ Aesthetic

## Overview

The web dashboard (`web/`) currently uses a generic gray-on-black palette with blue accent. The new marketing site (`site/`) has a refined dark theme with brand tokens, cyan/blue/purple gradients, and consistent surface hierarchy. This plan maps the web app to the site's design system.

---

## Design System Alignment

### Current → Target Token Map

| Current (web/) | Target (site/) | Purpose |
|---|---|---|
| `bg-gray-900` | `bg-brand-dark` | Page/background |
| `bg-gray-850` / `rgb(30,30,35)` | `bg-brand-surface` | Card/surface panels |
| `bg-gray-800` / `bg-gray-700` | `bg-brand-surface-2` / `bg-brand-surface-3` | Elevated surfaces |
| `border-gray-700` / `border-gray-600` | `border-brand-border` | Borders/dividers |
| `text-gray-400` / `text-gray-300` | `text-brand-text-muted` / `text-brand-text` | Body text |
| `text-gray-500` | `text-brand-text-muted` | Muted text |
| `bg-blue-600` / `text-blue-400` | `from-brand-cyan to-brand-blue` | Primary accent |
| `bg-purple-900/30` / `text-purple-100` | `text-brand-purple` | Assistant messages |
| `bg-emerald-500` / `bg-rose-500` | `text-emerald-400` / `text-rose-400` | Tool status |
| `bg-amber-500` | `text-amber-400` | Streaming status |
| `bg-yellow-600/30` | `bg-yellow-500/20` | Read-only banner |
| `bg-red-600/20` / `border-red-500/50` | `bg-red-500/10` / `border-red-500/30` | Error banners |
| N/A | `gradient-text` | Headline/accent text |

### CSS Additions Needed

`web/src/app.css` needs the same `@theme` block and utility classes from `site/src/app.css`:
- All brand color tokens
- `gradient-text` utility
- `gradient-border` utility (optional, for future use)
- `font-family: 'Inter', system-ui, -apple-system, sans-serif`
- Remove the `.bg-gray-850` custom class (replace with token)

---

## Component-by-Component Changes

### 1. `web/src/app.html`
- Change `bg-black text-white` → `bg-brand-dark text-brand-text`
- Add favicon link to `/logo.svg`
- Add meta description

### 2. `web/src/app.css`
- Add `@theme` block with all brand tokens
- Add `gradient-text` and `gradient-border` utilities
- Add font-family rule
- Remove `.bg-gray-850` custom class

### 3. `web/src/routes/+page.svelte` (Main Layout)

**Root container:**
- `bg-gray-900` → `bg-brand-dark`

**Sidebar:**
- `bg-gray-850` → `bg-brand-surface`
- `border-gray-700` → `border-brand-border`
- `bg-gray-800/10` → `bg-brand-surface-2/20`
- `text-gray-300` → `text-brand-text`
- `text-gray-400` → `text-brand-text-muted`
- `text-white` → `text-brand-text`
- `text-blue-400` → `text-brand-blue` (or gradient)
- `hover:bg-gray-800` → `hover:bg-brand-surface-2`
- `hover:bg-gray-700` → `hover:bg-brand-surface-3`
- `text-gray-700` → `text-brand-border`
- `bg-gray-800` → `bg-brand-surface-2`
- `bg-red-950/20` → `bg-red-500/10`
- `border-red-900/50` → `border-red-500/30`
- `text-red-400` → `text-rose-400`
- Remove `.bg-gray-850` style block at bottom

**Top bar:**
- `bg-gray-850` → `bg-brand-surface`
- `border-gray-700` → `border-brand-border`
- `text-gray-400` → `text-brand-text-muted`
- `text-gray-300` → `text-brand-text`
- `text-white` → `text-brand-text`
- `text-blue-400` → `text-brand-blue`
- `bg-gray-700` → `bg-brand-surface-3`
- `bg-yellow-600/30` → `bg-yellow-500/20`

**Notification banners:**
- `bg-red-600/20` → `bg-red-500/10`
- `border-red-500/50` → `border-red-500/30`
- `text-red-400` → `text-rose-400`
- `bg-yellow-600/20` → `bg-yellow-500/10`

**Mobile overlay:**
- `bg-black/50` → `bg-brand-dark/50`

### 4. `web/src/lib/components/ChatMessageList.svelte`

**Connection/loading states:**
- `bg-gray-900` → `bg-brand-dark`
- `text-gray-500` → `text-brand-text-muted`
- `text-gray-300` → `text-brand-text`
- `border-blue-500` → `border-brand-blue`
- `border-red-500/30` → `border-red-500/30`
- `bg-red-900/10` → `bg-red-500/10`
- `bg-red-950/40` → `bg-brand-surface-3`

**Session creation form:**
- `bg-gray-800` → `bg-brand-surface-2`
- `bg-gray-800/40` → `bg-brand-surface/40`
- `border-gray-700` → `border-brand-border`
- `text-gray-400` → `text-brand-text-muted`
- `text-white` → `text-brand-text`
- `border-gray-600` → `border-brand-border`
- `bg-gray-700` → `bg-brand-surface-3`
- `text-gray-200` → `text-brand-text`
- `text-blue-600` → `text-brand-blue`
- `focus:border-blue-500` → `focus:border-brand-blue`
- `bg-blue-600` → gradient or `from-brand-cyan to-brand-blue`
- `hover:bg-blue-700` → `hover:opacity-90`

**Chat messages:**
- User messages: `bg-blue-600` → `bg-brand-blue/80`
- Thinking: `bg-gray-900/30` → `bg-brand-surface/30`, `border-gray-600` → `border-brand-border`
- Tool: `bg-gray-800` → `bg-brand-surface-2`
- Assistant: `bg-purple-900/30` → `bg-brand-purple/10`, `border-purple-500` → `border-brand-purple`, `text-purple-100` → `text-brand-text`
- `border-amber-500` → `border-amber-400`
- `border-rose-500` → `border-rose-400`
- `border-emerald-500` → `border-emerald-400`
- `text-gray-300` → `text-brand-text`
- `text-gray-400` → `text-brand-text-muted`
- `text-gray-200` → `text-brand-text`
- Tool output backgrounds: `bg-gray-950/40` → `bg-brand-dark/60`
- `border-gray-700/20` → `border-brand-border/30`
- `border-gray-700/30` → `border-brand-border/40`
- `text-amber-400` → keep (good)
- `text-gray-300` → `text-brand-text`
- `text-gray-500` → `text-brand-text-muted`
- Attachment: `bg-blue-700/50` → `bg-brand-blue/20`, `text-blue-200` → `text-brand-text`
- `border-blue-500/30` → `border-brand-blue/20`

**Streaming abort:**
- `border-gray-700` → `border-brand-border`
- `bg-red-600` → `bg-rose-500`, `hover:bg-red-700` → `hover:bg-rose-600`

**Modals:**
- `bg-black/65` → `bg-brand-dark/65`
- `border-gray-700` → `border-brand-border`
- `bg-gray-800` → `bg-brand-surface-2`
- `text-gray-400` → `text-brand-text-muted`
- `text-gray-300` → `text-brand-text`
- `text-white` → `text-brand-text`

### 5. `web/src/lib/components/ChatInput.svelte`

- `border-gray-700` → `border-brand-border`
- `bg-gray-800` → `bg-brand-surface-2`
- `text-gray-500` → `text-brand-text-muted`
- `text-gray-400` → `text-brand-text-muted`
- `text-white` → `text-brand-text`
- `text-gray-300` → `text-brand-text`
- `border-gray-600` → `border-brand-border`
- `bg-gray-700` → `bg-brand-surface-3`
- `hover:bg-gray-700` → `hover:bg-brand-surface-3`
- `bg-blue-600` → gradient
- `hover:bg-blue-700` → `hover:opacity-90`
- `text-gray-200` → `text-brand-text`
- `text-blue-400` → `text-brand-blue`
- `text-gray-400` → `text-brand-text-muted`
- `bg-gray-700/50` → `bg-brand-surface-3/50`
- `bg-gray-750` → `bg-brand-surface-3` (note: 750 doesn't exist, use 3)
- `focus:border-blue-500` → `focus:border-brand-blue`
- `text-blue-600` → `text-brand-blue`
- `text-red-400` → `text-rose-400`
- `text-red-300` → `text-rose-300`
- `text-amber-600` → `text-amber-400`
- `bg-amber-600` → `bg-amber-500`
- `text-yellow-400` → `text-yellow-400` (keep)
- `text-emerald-500` → `text-emerald-400`
- `text-blue-200` → `text-brand-text`
- `border-blue-500/30` → `border-brand-blue/20`
- `bg-gray-900/60` → `bg-brand-dark/60`

### 6. `web/src/lib/components/SessionBrowser.svelte`

- `bg-gray-800/10` → `bg-brand-surface/10`
- `border-gray-700/50` → `border-brand-border/50`
- `text-blue-400` → `text-brand-blue`
- `text-gray-500` → `text-brand-text-muted`
- `text-gray-300` → `text-brand-text`
- `text-white` → `text-brand-text`
- `bg-gray-700/30` → `bg-brand-surface-3/30`
- `bg-gray-700/50` → `bg-brand-surface-3/50`
- `bg-gray-700` → `bg-brand-surface-3`
- `hover:bg-gray-700` → `hover:bg-brand-surface-3`
- `text-gray-600` → `text-brand-text-muted`
- `text-gray-200` → `text-brand-text`
- `border-gray-600` → `border-brand-border`
- `bg-gray-800` → `bg-brand-surface-2`
- `text-gray-400` → `text-brand-text-muted`
- `bg-gray-700/30` → `bg-brand-surface-3/30`
- `bg-gray-700` → `bg-brand-surface-3`
- `bg-gray-600` → `bg-brand-surface-3`
- `text-gray-300` → `text-brand-text`
- `bg-gray-800/80` → `bg-brand-surface-2/80`
- `border-red-500/30` → `border-red-500/30`
- `text-red-500` → `text-rose-400`
- `text-red-400` → `text-rose-400`
- `text-red-300` → `text-rose-300`
- `bg-black/60` → `bg-brand-dark/60`
- `text-yellow-500` → `text-yellow-400`
- `text-green-500` → `text-emerald-400`
- `bg-green-5