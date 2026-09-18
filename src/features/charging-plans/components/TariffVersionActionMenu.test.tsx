import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as SharedUi from '../../../shared/ui';
import * as tariffActionMenuModule from './TariffVersionActionMenu';

const { TariffVersionActionMenu } = tariffActionMenuModule;

type TariffActionDescriptor = {
  id: 'promotion' | 'retire' | 'delete';
  group: 'primary' | 'separated' | 'danger';
  label: string;
};

type TariffActionPresentation = 'sheet' | 'menu';

type TariffActionModuleContract = {
  getTariffActionDescriptors?: (input: { canRetire: boolean }) => readonly TariffActionDescriptor[];
  selectTariffActionPresentation?: (input: {
    width: number;
    pointer: 'fine' | 'coarse' | 'unavailable' | 'ambiguous';
    hover: 'hover' | 'none' | 'unavailable' | 'ambiguous';
  }) => TariffActionPresentation;
};

const tariffActionContract = tariffActionMenuModule as TariffActionModuleContract;

/**
 * Test suite for the tariff version action menu.
 *
 * Verifies required menu labels, action callbacks, and governed control sizing.
 */
describe('TariffVersionActionMenu', () => {
  it('keeps tariff overlay policy inside charging-plans without a shared or app-owned overlay API', () => {
    // Arrange: Read the app composition boundary and the shared UI public surface.
    const appSource = readFileSync(resolve(process.cwd(), 'src/app/App.tsx'), 'utf8');

    // Act: Inspect only the feature contract names and overlay modules governed by ADR 011.
    const sharedExports = SharedUi as Record<string, unknown>;

    // Assert: App does not own tariff availability/presentation and shared UI exposes no tariff overlay API.
    expect(appSource).not.toMatch(/getTariffActionDescriptors|selectTariffActionPresentation/);
    expect(appSource).not.toMatch(/TariffAction(?:Sheet|Popover)|tariffActionPlacement/);
    expect(sharedExports).not.toHaveProperty('TariffActionSheet');
    expect(sharedExports).not.toHaveProperty('TariffActionPopover');
    expect(sharedExports).not.toHaveProperty('calculateTariffActionPlacement');
  });

  it('derives the ordered, grouped exceptional actions from one feature-owned availability definition', () => {
    // Arrange: Request actions for a tariff that remains eligible for retirement.
    const getTariffActionDescriptors = tariffActionContract.getTariffActionDescriptors;

    // Act: Resolve the feature's public availability result.
    expect(getTariffActionDescriptors).toBeTypeOf('function');
    const actions = getTariffActionDescriptors!({ canRetire: true });

    // Assert: Promotion leads, Retire is separate when eligible, and Delete remains isolated.
    expect(actions).toEqual([
      { id: 'promotion', group: 'primary', label: 'Run temporary promotion' },
      { id: 'retire', group: 'separated', label: 'Retire tariff' },
      { id: 'delete', group: 'danger', label: 'Delete tariff' },
    ]);
    expect(actions.map((action) => action.id)).not.toContain('edit');
    expect(actions.map((action) => action.id)).not.toContain('add');
  });

  it('omits only the ineligible Retire action while preserving the promotion-first and separately destructive model', () => {
    // Arrange: Request actions for a tariff whose retirement is not eligible.
    const getTariffActionDescriptors = tariffActionContract.getTariffActionDescriptors;

    // Act: Resolve the feature's public availability result.
    expect(getTariffActionDescriptors).toBeTypeOf('function');
    const actions = getTariffActionDescriptors!({ canRetire: false });

    // Assert: The remaining actions retain their deliberate order and grouping.
    expect(actions).toEqual([
      { id: 'promotion', group: 'primary', label: 'Run temporary promotion' },
      { id: 'delete', group: 'danger', label: 'Delete tariff' },
    ]);
  });

  it.each([
    [{ width: 767, pointer: 'fine', hover: 'hover' }, 'sheet'],
    [{ width: 768, pointer: 'fine', hover: 'hover' }, 'menu'],
    [{ width: 1024, pointer: 'coarse', hover: 'hover' }, 'sheet'],
    [{ width: 1024, pointer: 'fine', hover: 'none' }, 'sheet'],
    [{ width: 1024, pointer: 'unavailable', hover: 'unavailable' }, 'sheet'],
    [{ width: 1024, pointer: 'ambiguous', hover: 'ambiguous' }, 'sheet'],
  ] as const)('selects the %s presentation for a capability snapshot', (capabilities, expectedPresentation) => {
    // Arrange: Provide the complete input capability snapshot at the md boundary.
    const selectTariffActionPresentation = tariffActionContract.selectTariffActionPresentation;

    // Act: Ask feature-owned policy to select exactly one action presentation.
    expect(selectTariffActionPresentation).toBeTypeOf('function');
    const presentation = selectTariffActionPresentation!(capabilities);

    // Assert: Only fine-pointer hover input at 768px or wider receives the menu.
    expect(presentation).toBe(expectedPresentation);
  });

  it('renders Retire alongside the unchanged promotion and delete actions', async () => {
    // Arrange: Render the menu with a callback for every active-tariff action.
    const onRetire = vi.fn();
    const onPromotion = vi.fn();
    const onDelete = vi.fn();
    const user = userEvent.setup();

    render(
      <TariffVersionActionMenu
        label="Ionity Lidl"
        onRetire={onRetire}
        onPromotion={onPromotion}
        onDelete={onDelete}
      />,
    );

    // Act: Open the menu and trigger each action.
    await user.click(screen.getByRole('button', { name: /tariff actions for ionity lidl/i }));
    await user.click(screen.getByRole('button', { name: /retire tariff/i }));
    await user.click(screen.getByRole('button', { name: /tariff actions for ionity lidl/i }));
    await user.click(screen.getByRole('button', { name: /run temporary promotion/i }));
    await user.click(screen.getByRole('button', { name: /tariff actions for ionity lidl/i }));
    await user.click(screen.getByRole('button', { name: /delete tariff/i }));

    // Assert: Retire is reachable without changing the established actions.
    expect(onRetire).toHaveBeenCalledTimes(1);
    expect(onPromotion).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /edit details/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /change price permanently/i })).not.toBeInTheDocument();
  });

  it.each([
    ['Retire tariff', 'retire'],
    ['Delete tariff', 'delete'],
  ] as const)('unmounts the outgoing action sheet before dispatching %s without restoring focus behind it', async (actionLabel, action) => {
    // Arrange: Force the compact modal action sheet and observe the handoff at the action boundary.
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 767 });
    const user = userEvent.setup();
    let outgoingSheetWasMountedAtDispatch = false;
    const onRetire = vi.fn(() => {
      outgoingSheetWasMountedAtDispatch = screen.queryByRole('dialog', { name: /tariff actions for ionity lidl/i }) != null;
    });
    const onDelete = vi.fn(() => {
      outgoingSheetWasMountedAtDispatch = screen.queryByRole('dialog', { name: /tariff actions for ionity lidl/i }) != null;
    });

    try {
      render(
        <TariffVersionActionMenu
          label="Ionity Lidl"
          onRetire={onRetire}
          onPromotion={vi.fn()}
          onDelete={onDelete}
        />,
      );
      const trigger = screen.getByRole('button', { name: /tariff actions for ionity lidl/i });

      // Act: Select a confirmation-producing action from the open sheet.
      await user.click(trigger);
      await user.click(screen.getByRole('button', { name: new RegExp(`^${actionLabel}$`, 'i') }));

      // Assert: Only the selected handoff is dispatched after its predecessor is gone.
      expect(action === 'retire' ? onRetire : onDelete).toHaveBeenCalledTimes(1);
      expect(outgoingSheetWasMountedAtDispatch).toBe(false);
      expect(document.activeElement).not.toBe(trigger);
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth });
    }
  });

  it('uses governed surface tokens and 44px minimum controls', () => {
    // Arrange: Render the action menu without interacting.
    render(
      <TariffVersionActionMenu
        label="Ionity Lidl"
        onRetire={vi.fn()}
        onPromotion={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    // Act: Inspect the trigger classes.
    const trigger = screen.getByRole('button', { name: /tariff actions for ionity lidl/i });

    // Assert: The trigger uses governed styling hooks and touch-target sizing.
    expect(trigger.className).toContain('bg-surface');
    expect(trigger.className).toContain('border-secondary/10');
    expect(trigger.className).toContain('text-primary');
    expect(trigger.className).toContain('min-h-[44px]');
  });

  it('closes when focus or pointer interaction moves outside the menu', async () => {
    // Arrange: Render the action menu next to another focusable page control.
    const user = userEvent.setup();
    render(
      <div>
        <TariffVersionActionMenu
          label="Ionity Lidl"
          onRetire={vi.fn()}
          onPromotion={vi.fn()}
          onDelete={vi.fn()}
        />
        <button type="button">Outside control</button>
      </div>
    );

    // Act: Open the menu, move focus outside, reopen it, then click elsewhere on the page.
    await user.click(screen.getByRole('button', { name: /tariff actions for ionity lidl/i }));
    expect(screen.getByRole('button', { name: /run temporary promotion/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /outside control/i }));
    await user.click(screen.getByRole('button', { name: /tariff actions for ionity lidl/i }));
    expect(screen.getByRole('button', { name: /delete tariff/i })).toBeInTheDocument();
    await user.click(document.body);

    // Assert: The menu surface is dismissed after outside focus and outside pointer interaction.
    expect(screen.queryByRole('button', { name: /run temporary promotion/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete tariff/i })).not.toBeInTheDocument();
  });
});
