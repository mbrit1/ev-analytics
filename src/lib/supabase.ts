import { createClient } from '@supabase/supabase-js';
import { isMockMode, MOCK_SUPABASE_URL } from './mock-utils';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || (isMockMode() ? MOCK_SUPABASE_URL : 'https://placeholder.supabase.co');
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || (isMockMode() ? 'mock-key' : 'placeholder-key');

export const supabase = createClient(supabaseUrl, supabasePublishableKey);
