import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { supabase } from '../../../lib/supabase';
import { LogIn, Loader2 } from 'lucide-react';
import { Slab } from '../../../components/ui/Slab';

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export const LoginForm: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  const onSubmit = async (data: LoginFormValues) => {
    setLoading(true);
    setAuthError(null);

    const { error } = await supabase.auth.signInWithPassword({
      email: data.email,
      password: data.password,
    });

    if (error) {
      setAuthError(error.message);
    }
    setLoading(false);
  };

  return (
    <main className="flex flex-col items-center justify-center min-h-screen p-4 bg-environment">
      <Slab className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight text-primary">EV Analytics</h1>
          <p className="mt-2 text-sm text-secondary">Private single-user access</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div>
            <label htmlFor="email" className="block text-sm font-bold uppercase tracking-wider text-secondary">
              Email Address
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              {...register('email')}
              aria-invalid={errors.email ? 'true' : 'false'}
              aria-describedby={errors.email ? 'email-error' : undefined}
              className="w-full px-4 py-3 mt-1 bg-transparent border-b border-secondary/20 focus:border-accent outline-none text-primary transition-colors"
              placeholder="you@example.com"
            />
            {errors.email && (
              <p className="mt-1 text-sm text-red-500" id="email-error">
                {errors.email.message}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-bold uppercase tracking-wider text-secondary">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              {...register('password')}
              aria-invalid={errors.password ? 'true' : 'false'}
              aria-describedby={errors.password ? 'password-error' : undefined}
              className="w-full px-4 py-3 mt-1 bg-transparent border-b border-secondary/20 focus:border-accent outline-none text-primary transition-colors"
              placeholder="••••••••"
            />
            {errors.password && (
              <p className="mt-1 text-sm text-red-500" id="password-error">
                {errors.password.message}
              </p>
            )}
          </div>

          {authError && (
            <div role="alert" className="p-3 text-sm text-red-500 bg-red-500/10 rounded-lg">
              {authError}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex items-center justify-center w-full py-4 px-4 text-white bg-accent rounded-xl font-bold hover:opacity-90 transition-all shadow-md shadow-accent/20 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px] mt-4"
          >
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
            ) : (
              <>
                <LogIn className="w-5 h-5 mr-2" aria-hidden="true" />
                Sign In
              </>
            )}
            {loading && <span className="sr-only">Signing in...</span>}
          </button>
        </form>
      </Slab>
    </main>
  );
};
