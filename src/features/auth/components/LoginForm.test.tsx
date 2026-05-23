import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthError } from '@supabase/supabase-js';
import { LoginForm } from './LoginForm';
import { useAuth } from '../hooks/useAuth';

vi.mock('../hooks/useAuth');

/**
 * Test suite for the login form authentication flow.
 *
 * Verifies credentials are forwarded to the auth hook and Supabase auth
 * errors are rendered inline without bypassing client-side validation.
 */
describe('LoginForm', () => {
  const mockSignIn = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      session: null,
      loading: false,
      signIn: mockSignIn,
      signOut: vi.fn(),
    });
    mockSignIn.mockResolvedValue({ error: null });
  });

  it('passes submitted credentials to signIn', async () => {
    // Arrange: Render login form with mocked auth hook and successful sign-in.
    const user = userEvent.setup();
    render(<LoginForm />);

    // Act: Enter valid credentials and submit.
    await user.type(screen.getByLabelText(/email address/i), 'driver@example.com');
    await user.type(screen.getByLabelText(/password/i), 'secret123');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    // Assert: Auth hook receives the exact submitted credentials.
    await waitFor(() => {
      expect(mockSignIn).toHaveBeenCalledWith('driver@example.com', 'secret123');
    });
  });

  it('renders auth error returned from signIn', async () => {
    // Arrange: Configure sign-in to return a Supabase auth error message.
    const user = userEvent.setup();
    const authError = { message: 'Invalid login credentials' } as AuthError;
    mockSignIn.mockResolvedValue({ error: authError });
    render(<LoginForm />);

    // Act: Submit valid credentials to trigger server-side auth handling.
    await user.type(screen.getByLabelText(/email address/i), 'driver@example.com');
    await user.type(screen.getByLabelText(/password/i), 'wrong-password');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    // Assert: The returned auth error is shown in the alert region.
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid login credentials');
  });

  it('shows thrown auth error message and re-enables submit when signIn rejects', async () => {
    // Arrange: Configure sign-in to reject and render the login form.
    const user = userEvent.setup();
    mockSignIn.mockRejectedValue(new Error('Network exploded'));
    render(<LoginForm />);

    // Act: Submit valid credentials and wait for async submit flow to settle.
    await user.type(screen.getByLabelText(/email address/i), 'driver@example.com');
    await user.type(screen.getByLabelText(/password/i), 'secret123');
    const submitButton = screen.getByRole('button', { name: /sign in/i });
    await user.click(submitButton);

    // Assert: Thrown auth message is rendered and the button is enabled again.
    expect(await screen.findByRole('alert')).toHaveTextContent('Network exploded');
    await waitFor(() => {
      expect(submitButton).toBeEnabled();
    });
  });
});
