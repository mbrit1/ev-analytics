/** A viewport-relative rectangle used by Tariffs menu placement. */
export interface TariffActionPlacementRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Inputs to the pure fixed-position Tariffs action menu placement helper. */
export interface TariffActionPlacementInput {
  trigger: TariffActionPlacementRect;
  overlay: Pick<TariffActionPlacementRect, 'width' | 'height'>;
  visualViewport: TariffActionPlacementRect | null;
  edgeGap: number;
  dockExclusion: TariffActionPlacementRect | null;
}

/** The position and optional scrolling bound selected for the Tariffs action menu. */
export interface TariffActionPlacement {
  left: number;
  top: number;
  side: 'below' | 'above';
  maxHeight?: number;
}

function getLayoutViewport(): TariffActionPlacementRect {
  return {
    left: 0,
    top: 0,
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

function intersectsHorizontally(
  first: TariffActionPlacementRect,
  second: TariffActionPlacementRect,
): boolean {
  return first.left < second.left + second.width && first.left + first.width > second.left;
}

/** Calculates collision-safe fixed placement for the feature-owned Tariffs menu. */
export function calculateTariffActionPlacement(
  input: TariffActionPlacementInput,
): TariffActionPlacement {
  const viewport = input.visualViewport ?? getLayoutViewport();
  const viewportRight = viewport.left + viewport.width;
  const viewportBottom = viewport.top + viewport.height;
  const dockOverlapsViewport = input.dockExclusion != null
    && intersectsHorizontally(input.dockExclusion, viewport)
    && input.dockExclusion.top < viewportBottom
    && input.dockExclusion.top + input.dockExclusion.height > viewport.top;
  const usableBottom = dockOverlapsViewport
    ? Math.min(viewportBottom, input.dockExclusion!.top)
    : viewportBottom;
  const minimumTop = viewport.top + input.edgeGap;
  const belowTop = input.trigger.top + input.trigger.height + input.edgeGap;
  const belowRoom = usableBottom - belowTop - input.edgeGap;
  const aboveRoom = input.trigger.top - input.edgeGap - minimumTop;
  const side = belowRoom >= input.overlay.height || belowRoom >= aboveRoom ? 'below' : 'above';
  const availableHeight = side === 'below' ? belowRoom : aboveRoom;
  const boundedHeight = Math.max(1, availableHeight);
  const renderedHeight = Math.min(input.overlay.height, boundedHeight);
  const preferredTop = side === 'below'
    ? belowTop
    : input.trigger.top - renderedHeight - input.edgeGap;
  const top = Math.max(minimumTop, Math.min(preferredTop, usableBottom - renderedHeight));
  const left = Math.min(
    Math.max(viewport.left + input.edgeGap, input.trigger.left + input.trigger.width - input.overlay.width),
    viewportRight - input.edgeGap - input.overlay.width,
  );

  return {
    left,
    top,
    side,
    ...(availableHeight < input.overlay.height ? { maxHeight: boundedHeight } : {}),
  };
}
