import { describe, expect, it } from 'vitest';

type Rect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type TariffActionPlacementInput = {
  trigger: Rect;
  overlay: Pick<Rect, 'width' | 'height'>;
  visualViewport: Rect | null;
  edgeGap: number;
  dockExclusion: Rect | null;
};

type TariffActionPlacement = {
  left: number;
  top: number;
  side: 'below' | 'above';
  maxHeight?: number;
};

type TariffActionPlacementModule = {
  calculateTariffActionPlacement: (input: TariffActionPlacementInput) => TariffActionPlacement;
};

async function loadTariffActionPlacement(): Promise<TariffActionPlacementModule | undefined> {
  const modulePath = './tariffActionPlacement';
  return import(/* @vite-ignore */ modulePath).catch(() => undefined) as Promise<TariffActionPlacementModule | undefined>;
}

/**
 * Defines collision-safe fixed placement for the feature-owned Tariffs menu.
 *
 * The helper is pure so viewport, dock, and zoom offsets remain deterministic.
 */
describe('calculateTariffActionPlacement', () => {
  it('prefers below and end-aligned placement while shifting the menu inside the usable viewport', async () => {
    // Arrange: Put a regular desktop trigger near the left and right usable edges.
    const module = await loadTariffActionPlacement();
    expect(module?.calculateTariffActionPlacement).toBeDefined();
    const calculate = module?.calculateTariffActionPlacement;
    if (!calculate) return;

    // Act: Place a normal end-aligned menu, then one that would extend outside the left edge.
    const endAlignedPlacement = calculate({
      trigger: { left: 700, top: 120, width: 44, height: 44 },
      overlay: { width: 280, height: 180 },
      visualViewport: { left: 0, top: 0, width: 1024, height: 768 },
      edgeGap: 16,
      dockExclusion: null,
    });
    const shiftedPlacement = calculate({
      trigger: { left: 10, top: 120, width: 44, height: 44 },
      overlay: { width: 280, height: 180 },
      visualViewport: { left: 0, top: 0, width: 1024, height: 768 },
      edgeGap: 16,
      dockExclusion: null,
    });

    // Assert: The preferred below/end result shifts only when it would otherwise clip.
    expect(endAlignedPlacement).toMatchObject({ left: 464, top: 180, side: 'below' });
    expect(shiftedPlacement).toMatchObject({ left: 16, top: 180, side: 'below' });
  });

  it('uses visual viewport offsets and flips above persistent navigation', async () => {
    // Arrange: Simulate zoomed visual viewport coordinates with a dock excluding the lower region.
    const module = await loadTariffActionPlacement();
    expect(module?.calculateTariffActionPlacement).toBeDefined();
    const calculate = module?.calculateTariffActionPlacement;
    if (!calculate) return;

    // Act: Place an oversized lower-edge overlay where below would collide with the dock.
    const placement = calculate({
      trigger: { left: 600, top: 530, width: 44, height: 44 },
      overlay: { width: 280, height: 260 },
      visualViewport: { left: 50, top: 100, width: 640, height: 480 },
      edgeGap: 16,
      dockExclusion: { left: 50, top: 520, width: 640, height: 60 },
    });

    // Assert: Fixed coordinates include viewport offsets and the menu never covers the dock.
    expect(placement).toMatchObject({ left: 364, top: 254, side: 'above' });
    expect(placement.top + (placement.maxHeight ?? 260)).toBeLessThanOrEqual(520);
  });

  it('bounds internal scrolling when neither side can fit the full menu', async () => {
    // Arrange: Use a zoomed viewport whose trigger leaves limited room on both sides.
    const module = await loadTariffActionPlacement();
    expect(module?.calculateTariffActionPlacement).toBeDefined();
    const calculate = module?.calculateTariffActionPlacement;
    if (!calculate) return;

    // Act: Place a menu taller than either usable side above the dock.
    const placement = calculate({
      trigger: { left: 400, top: 300, width: 44, height: 44 },
      overlay: { width: 280, height: 500 },
      visualViewport: { left: 50, top: 100, width: 640, height: 480 },
      edgeGap: 16,
      dockExclusion: { left: 50, top: 520, width: 640, height: 60 },
    });

    // Assert: Placement remains usable and exposes a positive bounded scroll height.
    expect(placement.left).toBeGreaterThanOrEqual(66);
    expect(placement.top).toBeGreaterThanOrEqual(116);
    expect(placement.maxHeight).toBeGreaterThan(0);
    expect(placement.top + (placement.maxHeight ?? 500)).toBeLessThanOrEqual(504);
  });
});
