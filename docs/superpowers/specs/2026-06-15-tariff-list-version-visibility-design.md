# Tariff List Version Visibility Design

## Summary
Refine the tariff overview card so upcoming tariff versions appear only when contextually relevant, using an explicit 3-state visibility model. Preserve version awareness inside the individual tariff card, keep the card visually compact, and avoid turning the list into a timeline.

This spec is a companion to `docs/superpowers/specs/2026-06-12-tariff-version-management-design.md`. The June 12 spec remains the source of truth for logical tariff workflows, while this document is the source of truth for the tariff-card visibility treatment for upcoming versions.

## Goal
Refactor the tariff list UI so upcoming tariff versions are shown only when contextually relevant, using the agreed 3-state visibility model. Remove any global `Tariff History` card that appears above the tariff list. Version awareness must stay attached to the individual tariff card.

The implementation must be configurable so the visibility thresholds can be adjusted in the future without modifying business logic.

## Relationship To Existing Tariff Version Management
- The tariff overview still shows one card per logical tariff.
- Full version history remains a secondary detail surface.
- Only the nearest upcoming version affects tariff-list visibility.
- This design changes how future updates are surfaced in the overview card, not the underlying version-management semantics.

## Design Rules
Use the existing Enyaq Suite Floating Slab style:

- Apple-native, premium, soft slab cards.
- Light mode uses `#F5F5F7` background, `#FFFFFF` surface, `#1D1D1F` text, and `#86868B` secondary text.
- Dark mode uses `#000000` background, `#1C1C1E` surface, `#F5F5F7` text, and `#8E8E93` secondary text.
- Accent remains `#007AFF`.
- Use tabular numbers for all prices and dates.
- Keep the tariff card compact.
- Do not highlight individual future prices.
- Only display price categories that actually change.
- Preserve the current card height for tariffs without upcoming updates.

## Visibility Model

### State 1: No List Visibility
Condition:

```text
daysUntilChange > INDICATOR_THRESHOLD_DAYS
```

Default:

```ts
INDICATOR_THRESHOLD_DAYS = 30
```

Behavior:
- Show nothing in the tariff list.
- Future version remains visible in the detail or history surface only.
- Preserve the existing compact card height.

### State 2: Update Indicator
Condition:

```text
PREVIEW_THRESHOLD_DAYS < daysUntilChange <= INDICATOR_THRESHOLD_DAYS
```

Defaults:

```ts
PREVIEW_THRESHOLD_DAYS = 7
INDICATOR_THRESHOLD_DAYS = 30
```

Behavior:
- Show a subtle update indicator.
- Do not show future prices.
- Do not increase information density unnecessarily.

Example:

```text
Update scheduled · 01 Jul 2026
```

### State 3: Future Price Preview
Condition:

```text
0 <= daysUntilChange <= PREVIEW_THRESHOLD_DAYS
```

Default:

```ts
PREVIEW_THRESHOLD_DAYS = 7
```

Behavior:
- Show a compact future-preview section.
- Show only price categories that change.
- Do not use accent colors or bold styling to emphasize changed values.
- The presence of the future section already communicates that the listed values are changing.

Example:

```text
Next Update · 01 Jul 2026
Domestic DC 0,49 € · Roaming DC 0,63 €
```

## Date Semantics
- Day windows use UTC calendar-day semantics.
- `daysUntilChange` is calculated from the start of the current UTC day to the start of the future version's UTC effective day.
- A future version effective today is in preview state.
- A future version effective in 8 UTC days is in indicator state.
- A future version effective in 31 UTC days is hidden in the list.
- Past effective dates never surface as upcoming list visibility.

## Configuration
Implement visibility thresholds as configurable constants.

Default values:

```ts
export const PREVIEW_THRESHOLD_DAYS = 7;
export const INDICATOR_THRESHOLD_DAYS = 30;
```

The UI should behave identically using these defaults, but future tuning should only require changing the constants.

## Visibility Logic

```ts
export const PREVIEW_THRESHOLD_DAYS = 7;
export const INDICATOR_THRESHOLD_DAYS = 30;

export function getTariffUpdateVisibility(
  effectiveDate: Date,
  today = new Date()
): 'none' | 'indicator' | 'preview' {
  const msPerDay = 1000 * 60 * 60 * 24;

  const daysUntilChange = Math.ceil(
    (
      startOfDay(effectiveDate).getTime() -
      startOfDay(today).getTime()
    ) / msPerDay
  );

  if (daysUntilChange < 0) {
    return 'none';
  }

  if (daysUntilChange > INDICATOR_THRESHOLD_DAYS) {
    return 'none';
  }

  if (daysUntilChange > PREVIEW_THRESHOLD_DAYS) {
    return 'indicator';
  }

  return 'preview';
}
```

## Content Rules For Preview State
- Compare the current effective version to the nearest upcoming version.
- Include only categories whose displayed amount changes.
- Categories may include:
  - domestic AC price
  - domestic DC price
  - roaming AC price
  - roaming DC price
  - monthly base fee
  - session fee
- Do not include provider, tariff name, affiliation, notes, or other descriptive metadata in the preview diff.
- A category that is absent in both versions is omitted.
- A category that changes from absent to present, or present to absent, counts as changed and may be shown if the UI can express it clearly.

## Card Behavior
- Version awareness must stay attached to the individual tariff card.
- The card keeps the current effective prices as the primary information.
- Indicator state adds one quiet metadata line.
- Preview state adds one compact future section beneath the current prices.
- The card must not become a full inline history timeline.
- Cards without visible upcoming updates should render with the same spacing and visual rhythm as today.

## Detail Surface
- Full version history remains available in a secondary surface.
- The history surface is not the primary mechanism for upcoming-change awareness in the list.
- If no global `Tariff History` card exists, no new global history card should be introduced for this feature.

## Target HTML Structure

```html
<article class="tariff-card slab">
  <header class="tariff-card__header">
    <div>
      <h2 class="tariff-card__title">Tesla</h2>
      <p class="tariff-card__subtitle">
        Supercharger Standard
      </p>
    </div>
  </header>

  <div class="tariff-card__prices">
    <div class="tariff-row">
      <strong>Domestic DC</strong>
      <span class="price">0,45 €</span>
    </div>

    <div class="tariff-row">
      <strong>Roaming DC</strong>
      <span class="price">0,59 €</span>
    </div>
  </div>

  <!-- Render only for state: indicator -->
  <div class="future-indicator">
    Update scheduled · 01 Jul 2026
  </div>

  <!-- Render only for state: preview -->
  <div class="future-preview">
    <div class="divider"></div>

    <div class="future-note">
      <div class="future-note-label">
        Next Update · 01 Jul 2026
      </div>

      <div class="future-note-copy">
        Domestic DC 0,49 € · Roaming DC 0,63 €
      </div>
    </div>
  </div>
</article>
```

## Target CSS

```css
:root {
  --bg: #F5F5F7;
  --surface: #FFFFFF;
  --text: #1D1D1F;
  --muted: #86868B;
  --shadow: 0 10px 30px rgba(0, 0, 0, 0.04);
  --border: 1px solid rgba(0, 0, 0, 0.08);
  --accent: #007AFF;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #000000;
    --surface: #1C1C1E;
    --text: #F5F5F7;
    --muted: #8E8E93;
    --shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
    --border: 1px solid rgba(255, 255, 255, 0.1);
  }
}

.slab {
  background: var(--surface);
  border: var(--border);
  box-shadow: var(--shadow);
  border-radius: 28px;
}

.tariff-card {
  padding: 20px;
  color: var(--text);
  font-family:
    "SF Pro Rounded",
    "SF Pro Display",
    -apple-system,
    BlinkMacSystemFont,
    sans-serif;
}

.price,
.future-note-label,
.future-note-copy,
.future-indicator {
  font-variant-numeric: tabular-nums;
}

.future-indicator {
  width: fit-content;
  margin-top: 14px;
  padding: 7px 11px;
  border-radius: 999px;
  background: rgba(0, 122, 255, 0.12);
  color: var(--accent);
  font-size: 12px;
  font-weight: 700;
}

.divider {
  height: 1px;
  margin: 16px 0 12px;
  background: rgba(134, 134, 139, 0.18);
}

.future-note {
  display: grid;
  gap: 4px;
}

.future-note-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
}

.future-note-copy {
  font-size: 13px;
  line-height: 1.45;
  color: var(--text);
}
```

## Acceptance Criteria
- No standalone tariff history card appears above the tariff list.
- Future version UI is rendered only inside the affected tariff card.
- Visibility thresholds are implemented using configurable constants.
- Default thresholds are 7 days for preview and 30 days for indicator.
- Future update older than today is hidden.
- Future update beyond 30 days is hidden.
- Future update between 8 and 30 days shows only the indicator.
- Future update within 7 days shows the preview block.
- Preview lists only changed prices or fees.
- No future price receives special highlighting.
- Existing tariff cards without future updates remain visually unchanged in height and spacing.
- All prices and dates use tabular numerics.
