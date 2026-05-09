# Design System

This directory is the internal boundary between reusable UI and app-specific
features.

## Structure

- `foundation/`: tokens, reset, typography, spacing, grid, and layout
  primitives that are safe to apply globally.
- `components/`: reusable Astro UI components that do not import app-specific
  domain logic.

## Rules

- Design-system components may import from `@design-system/*`.
- Design-system components must not import from app feature components or
  domain-specific `src/lib/*` modules.
- App pages and feature components may import from `@design-system/*`.
- Page-level `<style>` blocks should not be used to style child Astro
  components when the styling belongs in a reusable component or foundation
  class.
