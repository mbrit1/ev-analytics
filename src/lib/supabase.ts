import { createClient } from '@supabase/supabase-js';
import { isMockMode, MOCK_SUPABASE_URL } from './mock-utils';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || (isMockMode() ? MOCK_SUPABASE_URL : '');
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || (isMockMode() ? 'mock-key' : '');

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error('Missing Supabase environment variables. Please check your .env.local file.');
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey);
