import { createClient } from '@supabase/supabase-js';
import { isMockMode, MOCK_SUPABASE_URL } from '../mocks';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || (isMockMode() ? MOCK_SUPABASE_URL : 'https://placeholder.supabase.co');
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || (isMockMode() ? 'mock-key' : 'placeholder-key');

/**
 * Shared Supabase client used by auth, sync, and remote data hydration.
 *
 * Mock mode points the client at the MSW-backed mock Supabase URL so local
 * development can exercise authenticated flows without real credentials.
 */
export const supabase = createClient(supabaseUrl, supabasePublishableKey);
