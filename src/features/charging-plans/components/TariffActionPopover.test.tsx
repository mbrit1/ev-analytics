import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ComponentType, type RefObject, useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

type TariffAction = {
  id: 'promotion' | 'retire' | 'delete';
  group: 'primary' | 'separated' | 'danger';
  label: string;
  onSelect: () => void;
};

type TariffActionPopoverProps = {
  open: boolean;
  label: string;
  actions: readonly TariffAction[];
  triggerRef: RefObject<HTMLButtonElement | null>;
  dockExclusion: DOMRect | null;
  onDismiss: () => void;
};

type TariffActionPopoverModule = {
  TariffActionPopover: ComponentType<TariffActionPopoverProps>;
};

const actions: readonly TariffAction[] = [
  { id: 'promotion', group: 'primary', label: 'Run temporary promotion', onSelect: vi.fn() },
  { id: 'retire', group: 'separated', label: 'Retire tariff', onSelect: vi.fn() },
  { id: 'delete', group: 'danger', label: 'Delete tariff', onSelect: vi.fn() },
];

function createRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    width,
    height,
    left,
    top,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

async function loadTariffActionPopover(): Promise<TariffActionPopoverModule | undefined> {
  const modulePath = './TariffActionPopover';
  return import(/* @vite-ignore */ modulePath).catch(() => undefined) as Promise<TariffActionPopoverModule | undefined>;
}

function TariffActionPopoverHarness({
  Popover,
  dockExclusion = null,
}: {
  Popover: ComponentType<TariffActionPopoverProps>;
  dockExclusion?: DOMRect | null;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <main>
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>
        Tariff actions for Ionity Lidl
      </button>
      <button type="button">Outside control</button>
      <Popover
        open={open}
        label="Tariff actions for Ionity Lidl"
        actions={actions}
        triggerRef={triggerRef}
        dockExclusion={dockExclusion}
        onDismiss={() => setOpen(false)}
      />
    </main>
  );
}

/**
 * Specifies the regular fine-pointer Tariffs menu before its production implementation.
 *
 * The popover remains feature-local and delegates collision math to the pure helper.
 */
describe('TariffActionPopover', () => {
  it('portals an accessible menu with initial focus, Arrow/Home/End navigation, outside dismissal, and trigger restoration', async () => {
    // Arrange: Load the optional future desktop surface beside an outside page control.
    const module = await loadTariffActionPopover();
    expect(module?.TariffActionPopover).toBeDefined();
    const Popover = module?.TariffActionPopover;
    if (!Popover) return;
    const user = userEvent.setup();
    const { container } = render(<TariffActionPopoverHarness Popover={Popover} />);
    const trigger = screen.getByRole('button', { name: 'Tariff actions for Ionity Lidl' });

    // Act: Open, navigate from the first action through the menu boundaries, then dismiss.
    await user.click(trigger);
    const menu = screen.getByRole('menu', { name: 'Tariff actions for Ionity Lidl' });
    const promotion = screen.getByRole('menuitem', { name: 'Run temporary promotion' });
    const retire = screen.getByRole('menuitem', { name: 'Retire tariff' });
    const deletion = screen.getByRole('menuitem', { name: 'Delete tariff' });
    expect(promotion).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(retire).toHaveFocus();
    await user.keyboard('{End}');
    expect(deletion).toHaveFocus();
    await user.keyboard('{Home}');
    expect(promotion).toHaveFocus();
    expect(menu.parentElement).not.toBe(container);
    await user.click(screen.getByRole('button', { name: 'Outside control' }));

    // Assert: Outside and Escape dismissal both remove the menu and safely restore its trigger.
    expect(screen.queryByRole('menu', { name: 'Tariff actions for Ionity Lidl' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu', { name: 'Tariff actions for Ionity Lidl' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('recomputes fixed placement on viewport and window changes without covering the dock', async () => {
    // Arrange: Load the optional future surface with a lower-edge trigger and a measurable portal.
    const module = await loadTariffActionPopover();
    expect(module?.TariffActionPopover).toBeDefined();
    const Popover = module?.TariffActionPopover;
    if (!Popover) return;
    const user = userEvent.setup();
    const previousVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport');
    const visualViewport = new EventTarget();
    Object.assign(visualViewport, {
      offsetLeft: 0,
      offsetTop: 0,
      width: 1024,
      height: 768,
      scale: 1,
    });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: visualViewport });
    const dockExclusion = createRect(0, 700, 1024, 68);
    let unmount: (() => void) | undefined;

    try {
      const rendered = render(
        <TariffActionPopoverHarness Popover={Popover} dockExclusion={dockExclusion} />,
      );
      unmount = rendered.unmount;
    const trigger = screen.getByRole('button', { name: 'Tariff actions for Ionity Lidl' });
    const triggerRect = vi.spyOn(trigger, 'getBoundingClientRect')
      .mockReturnValue(createRect(920, 690, 44, 44));

      // Act: Open, then move the trigger before visual-viewport and window layout events.
      await user.click(trigger);
      const menu = screen.getByRole('menu', { name: 'Tariff actions for Ionity Lidl' });
      vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue(createRect(0, 0, 280, 180));
      visualViewport.dispatchEvent(new Event('resize'));
      const visualResizeTop = menu.style.top;
      triggerRect.mockReturnValue(createRect(100, 100, 44, 44));
      visualViewport.dispatchEvent(new Event('scroll'));
      expect(menu.style.top).not.toBe(visualResizeTop);
      const visualScrollTop = menu.style.top;
      triggerRect.mockReturnValue(createRect(300, 240, 44, 44));
      fireEvent.resize(window);
      expect(menu.style.top).not.toBe(visualScrollTop);
      const windowResizeTop = menu.style.top;
      triggerRect.mockReturnValue(createRect(500, 360, 44, 44));
      fireEvent.scroll(window);

      // Assert: Placement stays fixed, refreshes for every source, and excludes the dock.
      expect(menu).toHaveStyle({ position: 'fixed' });
      expect(menu.style.top).not.toBe(windowResizeTop);
      expect(Number.parseFloat(menu.style.top)).toBeGreaterThanOrEqual(0);
      expect(Number.parseFloat(menu.style.left)).toBeGreaterThanOrEqual(0);
      expect(Number.parseFloat(menu.style.top) + 180).toBeLessThanOrEqual(dockExclusion.top);
    } finally {
      unmount?.();
      if (previousVisualViewport) {
        Object.defineProperty(window, 'visualViewport', previousVisualViewport);
      } else {
        Reflect.deleteProperty(window, 'visualViewport');
      }
    }
  });

  it('closes without attempting trigger restoration when the invoking element is disconnected', async () => {
    // Arrange: Load the optional future surface with a trigger that disappeared during an open menu.
    const module = await loadTariffActionPopover();
    expect(module?.TariffActionPopover).toBeDefined();
    const Popover = module?.TariffActionPopover;
    if (!Popover) return;
    const trigger = document.createElement('button');
    const onDismiss = vi.fn();

    // Act: Mount an open menu whose captured trigger is no longer connected.
    render(
      <Popover
        open
        label="Tariff actions for Ionity Lidl"
        actions={actions}
        triggerRef={{ current: trigger }}
        dockExclusion={null}
        onDismiss={onDismiss}
      />,
    );

    // Assert: The feature closes safely rather than focusing a detached trigger.
    await waitFor(() => expect(onDismiss).toHaveBeenCalledOnce());
  });
});
