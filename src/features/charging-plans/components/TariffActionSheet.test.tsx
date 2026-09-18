import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ComponentType, type RefObject, useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

type TariffAction = {
  id: 'promotion' | 'retire' | 'delete';
  group: 'primary' | 'separated' | 'danger';
  label: string;
  onSelect: () => void;
};

type TariffActionSheetProps = {
  open: boolean;
  label: string;
  displayIdentity: string;
  actions: readonly TariffAction[];
  triggerRef: RefObject<HTMLButtonElement | null>;
  onDismiss: () => void;
};

type TariffActionSheetModule = {
  TariffActionSheet: ComponentType<TariffActionSheetProps>;
};

const actions: readonly TariffAction[] = [
  { id: 'promotion', group: 'primary', label: 'Run temporary promotion', onSelect: vi.fn() },
  { id: 'retire', group: 'separated', label: 'Retire tariff', onSelect: vi.fn() },
  { id: 'delete', group: 'danger', label: 'Delete tariff', onSelect: vi.fn() },
];

async function loadTariffActionSheet(): Promise<TariffActionSheetModule | undefined> {
  const modulePath = './TariffActionSheet';
  return import(/* @vite-ignore */ modulePath).catch(() => undefined) as Promise<TariffActionSheetModule | undefined>;
}

function TariffActionSheetHarness({ Sheet }: { Sheet: ComponentType<TariffActionSheetProps> }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <main>
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>
        Tariff actions for Ionity Lidl
      </button>
      <button type="button">Background control</button>
      <Sheet
        open={open}
        label="Ionity Lidl"
        displayIdentity="Ionity"
        actions={actions}
        triggerRef={triggerRef}
        onDismiss={() => setOpen(false)}
      />
    </main>
  );
}

/**
 * Specifies the compact Tariffs action sheet before its production implementation.
 *
 * The contract keeps modal isolation and focus ownership inside charging-plans.
 */
describe('TariffActionSheet', () => {
  it('portals a labelled modal sheet with scrim, inert background, and a stable body scroll lock', async () => {
    // Arrange: Load the optional future feature surface and retain pre-existing scroll styling.
    const module = await loadTariffActionSheet();
    expect(module?.TariffActionSheet).toBeDefined();
    const Sheet = module?.TariffActionSheet;
    if (!Sheet) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'clip';
    const scrollPosition = window.scrollY;
    const user = userEvent.setup();
    let unmount: (() => void) | undefined;

    try {
      const rendered = render(<TariffActionSheetHarness Sheet={Sheet} />);
      unmount = rendered.unmount;

      // Act: Open the compact action surface.
      await user.click(screen.getByRole('button', { name: 'Tariff actions for Ionity Lidl' }));
      const dialog = screen.getByRole('dialog', { name: 'Tariff actions for Ionity Lidl' });

      // Assert: The sheet is body-portalled and isolates the document without document reflow.
      expect(dialog.parentElement).not.toBe(rendered.container);
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(screen.getByText('Ionity')).toBeInTheDocument();
      expect(screen.getByText('Tariff actions')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Dismiss tariff actions' })).not.toBeInTheDocument();
      expect(rendered.container).toHaveAttribute('inert');
      expect(document.body.style.overflow).toBe('hidden');
      expect(window.scrollY).toBe(scrollPosition);
      expect(dialog).toHaveClass('overflow-y-auto', 'pb-[max(1rem,env(safe-area-inset-bottom))]');
    } finally {
      unmount?.();
      document.body.style.overflow = previousOverflow;
    }
  });

  it('traps focus and restores the invoking trigger after Escape, Cancel, or scrim dismissal', async () => {
    // Arrange: Load the optional future surface with a real invoking control.
    const module = await loadTariffActionSheet();
    expect(module?.TariffActionSheet).toBeDefined();
    const Sheet = module?.TariffActionSheet;
    if (!Sheet) return;
    const user = userEvent.setup();
    render(<TariffActionSheetHarness Sheet={Sheet} />);
    const trigger = screen.getByRole('button', { name: 'Tariff actions for Ionity Lidl' });

    // Act: Dismiss once with Escape, once with Cancel, and once with the scrim.
    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Tariff actions for Ionity Lidl' });
    expect(dialog).toContainElement(document.activeElement as HTMLElement | null);
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    cancel.focus();
    await user.tab();
    expect(dialog).toContainElement(document.activeElement as HTMLElement | null);
    await user.tab({ shift: true });
    expect(dialog).toContainElement(document.activeElement as HTMLElement | null);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Tariff actions for Ionity Lidl' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    const scrim = screen.getByRole('dialog', { name: 'Tariff actions for Ionity Lidl' }).previousElementSibling;
    expect(scrim).toBeInstanceOf(HTMLElement);
    await user.click(scrim as HTMLElement);

    // Assert: Every ordinary dismissal removes the sheet and returns to its captured trigger.
    expect(screen.queryByRole('dialog', { name: 'Tariff actions for Ionity Lidl' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('keeps the scrim in a dedicated layer below the foreground dialog wrapper', async () => {
    // Arrange: Open the sheet so its portal layers can be inspected.
    const module = await loadTariffActionSheet();
    expect(module?.TariffActionSheet).toBeDefined();
    const Sheet = module?.TariffActionSheet;
    if (!Sheet) return;
    const user = userEvent.setup();
    render(<TariffActionSheetHarness Sheet={Sheet} />);

    // Act: Open the compact action surface.
    await user.click(screen.getByRole('button', { name: 'Tariff actions for Ionity Lidl' }));
    const dialog = screen.getByRole('dialog', { name: 'Tariff actions for Ionity Lidl' });
    const root = dialog.parentElement;
    const scrim = dialog.previousElementSibling;

    // Assert: The portal establishes an isolated root and explicit scrim/foreground ordering.
    expect(scrim).toBeInstanceOf(HTMLElement);
    expect(root).toHaveClass('fixed', 'inset-0', 'z-50', 'isolate');
    expect(scrim).toHaveClass('absolute', 'inset-0', 'bg-black/50');
    expect(dialog).toHaveClass('relative', 'z-10');
    expect(root?.firstElementChild).toBe(scrim);
    expect(root?.lastElementChild).toBe(dialog);
  });

  it('renders a non-interactive identity header and a separate cancel slab in action order', async () => {
    // Arrange: Open the sheet with all lifecycle actions available.
    const module = await loadTariffActionSheet();
    expect(module?.TariffActionSheet).toBeDefined();
    const Sheet = module?.TariffActionSheet;
    if (!Sheet) return;
    const user = userEvent.setup();
    render(<TariffActionSheetHarness Sheet={Sheet} />);
    await user.click(screen.getByRole('button', { name: 'Tariff actions for Ionity Lidl' }));

    // Act: Read the modal's interactive sequence and slab structure.
    const dialog = screen.getByRole('dialog', { name: 'Tariff actions for Ionity Lidl' });
    const controls = Array.from(dialog.querySelectorAll('button')).map((button) => button.textContent);

    // Assert: Header is informational, lifecycle actions are ordered, and Cancel is isolated below.
    expect(controls).toEqual(['Run temporary promotion', 'Retire tariff', 'Delete tariff', 'Cancel']);
    expect(screen.getByText('Ionity').tagName).toBe('H2');
    expect(screen.getByText('Tariff actions').tagName).toBe('P');
    expect(screen.getByText('Ionity')).not.toHaveAttribute('tabindex');
    const slabs = dialog.querySelectorAll(':scope > section');
    expect(slabs).toHaveLength(2);
    expect(dialog).toHaveClass('gap-2');
    expect(slabs[1]).toHaveClass('rounded-[24px]', 'border-slab-border');
    expect(dialog.querySelectorAll('.border-t')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Run temporary promotion' })).toHaveClass('text-primary');
    expect(screen.getByRole('button', { name: 'Delete tariff' })).toHaveClass('text-red-600');
  });
});
