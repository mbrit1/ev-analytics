import { createClient } from '@supabase/supabase-js';
import { isMockMode, MOCK_SUPABASE_URL } from '../mocks';

const mockMode = isMockMode();
const configuredSupabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const configuredSupabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!mockMode && (!configuredSupabaseUrl || !configuredSupabasePublishableKey)) {
  throw new Error(
    'Missing Supabase configuration: VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are required outside mock mode.'
  );
}

const supabaseUrl = mockMode ? MOCK_SUPABASE_URL : configuredSupabaseUrl!;
const supabasePublishableKey = mockMode ? 'mock-key' : configuredSupabasePublishableKey!;

/**
 * Shared Supabase client used by auth, sync, and remote data hydration.
 *
 * Mock mode points the client at the MSW-backed mock Supabase URL so local
 * development can exercise authenticated flows without real credentials.
 */
export const supabase = createClient(supabaseUrl, supabasePublishableKey);
