import { createClient, SupabaseClient, User } from '@supabase/supabase-js';

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || import.meta.env.NEXT_PUBLIC_SUPABASE_URL) as string | undefined;
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) as string | undefined;

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
    supabaseAnonKey &&
    !supabaseUrl.includes('your-project-id') &&
    !supabaseAnonKey.includes('your-supabase-anon-key')
);

export interface AuthenticatedUser {
  id: string;
  email: string | null;
  username: string | null;
}

let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured || !supabaseUrl || !supabaseAnonKey) {
    return null;
  }
  if (!client) {
    client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}

function extractRealUsername(user: User): string | null {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const candidates = [
    meta.username,
    meta.preferred_username,
    meta.user_name,
    meta.display_name,
    meta.full_name,
    meta.name,
  ];
  for (const val of candidates) {
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (trimmed.length > 0 && !trimmed.includes('@')) {
        return trimmed;
      }
    }
  }
  return null;
}

function toAuthenticatedUser(user: User | null | undefined): AuthenticatedUser | null {
  if (!user || user.is_anonymous) return null;
  return {
    id: user.id,
    email: user.email ?? null,
    username: extractRealUsername(user),
  };
}

export async function getAuthenticatedSessionUser(): Promise<AuthenticatedUser | null> {
  const sb = getSupabaseClient();
  if (!sb) return null;
  try {
    const { data, error } = await sb.auth.getSession();
    if (error) return null;
    return toAuthenticatedUser(data.session?.user);
  } catch {
    return null;
  }
}

export async function resolveEmailFromIdentifier(identifier: string): Promise<string> {
  const clean = identifier.trim();
  if (clean.includes('@')) {
    return clean.toLowerCase();
  }

  const sb = getSupabaseClient();
  if (!sb) {
    throw new Error('Supabase client is not configured.');
  }

  // 1. Probaj preko RPC funkcije (sigurno pretraživanje emaila po username-u)
  try {
    const { data, error } = await sb.rpc('get_email_by_username', { p_username: clean });
    if (!error && typeof data === 'string' && data.includes('@')) {
      return data;
    }
  } catch {
    // nastavi na direktan upit
  }

  // 2. Probaj direktan upit ako RLS dozvoljava
  try {
    const { data } = await sb
      .from('user_profiles')
      .select('linked_email')
      .ilike('display_name', clean)
      .maybeSingle();

    if (data?.linked_email) {
      return data.linked_email;
    }
  } catch {
    // nastavi
  }

  throw new Error(`User with username "${clean}" was not found. Please check your username or sign in using your email address.`);
}

export async function signInWithSupabaseIdentifier(
  identifier: string,
  password: string
): Promise<{ user: AuthenticatedUser }> {
  const sb = getSupabaseClient();
  if (!sb) {
    throw new Error('Authentication provider is not configured.');
  }

  const email = await resolveEmailFromIdentifier(identifier);
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(error.message === 'Invalid login credentials' ? 'Invalid username/email or password.' : error.message);
  }
  const authUser = toAuthenticatedUser(data.user ?? data.session?.user);
  if (!authUser) {
    throw new Error('Could not restore authenticated user session.');
  }
  return { user: authUser };
}

export const signInWithSupabaseEmail = signInWithSupabaseIdentifier;

export function createSignupClient(): SupabaseClient | null {
  if (!isSupabaseConfigured || !supabaseUrl || !supabaseAnonKey) {
    return null;
  }
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export async function signUpWithSupabase(
  email: string,
  password: string,
  username: string
): Promise<{ user: AuthenticatedUser | null; needsEmailConfirmation: boolean; username: string }> {
  // Koristimo izolovani klijent sa persistSession: false tako da registracija ne prijavljuje automatski korisnika
  const sb = createSignupClient() || getSupabaseClient();
  if (!sb) {
    throw new Error('Authentication provider is not configured.');
  }

  const cleanUser = username.trim();
  const cleanEmail = email.trim().toLowerCase();

  if (cleanUser.length < 3) {
    throw new Error('Username must be at least 3 characters long.');
  }

  // Check if username is already taken
  try {
    const existingEmail = await resolveEmailFromIdentifier(cleanUser).catch(() => null);
    if (existingEmail) {
      throw new Error(`Username "${cleanUser}" is already taken. Please choose another.`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('already taken')) {
      throw err;
    }
  }

  const { data, error } = await sb.auth.signUp({
    email: cleanEmail,
    password,
    options: {
      data: {
        username: cleanUser,
        display_name: cleanUser,
      },
    },
  });

  if (error) throw new Error(error.message);

  // Ažuriraj user_profiles sa display_name i linked_email ako je sesija odmah aktivna
  if (data.user) {
    try {
      await sb
        .from('user_profiles')
        .upsert({
          id: data.user.id,
          display_name: cleanUser,
          linked_email: cleanEmail,
          is_anonymous: false,
        });
    } catch {
      // Ignoriši ako trigger to rešava
    }
  }

  return {
    user: null,
    needsEmailConfirmation: false,
    username: cleanUser,
  };
}

export const signUpWithSupabaseEmail = signUpWithSupabase;

export async function signOutSupabase(): Promise<void> {
  const sb = getSupabaseClient();
  if (!sb) return;
  const { error } = await sb.auth.signOut();
  if (error) throw new Error(error.message);
}

export function onSupabaseAuthChange(
  callback: (user: AuthenticatedUser | null) => void
): () => void {
  const sb = getSupabaseClient();
  if (!sb) return () => {};
  const { data } = sb.auth.onAuthStateChange((_event, session) => {
    callback(toAuthenticatedUser(session?.user));
  });
  return () => {
    data.subscription.unsubscribe();
  };
}

export async function ensureAnonymousSession(): Promise<{
  userId: string;
  isCloud: boolean;
  error?: string;
}> {
  const sb = getSupabaseClient();
  if (!sb) {
    return {
      userId: getOrCreateLocalAnonId(),
      isCloud: false,
    };
  }

  try {
    const { data: sessionData, error: sessionErr } = await sb.auth.getSession();
    if (sessionErr) throw sessionErr;

    if (sessionData.session?.user) {
      return {
        userId: sessionData.session.user.id,
        isCloud: true,
      };
    }

    const { data: anonData, error: anonErr } = await sb.auth.signInAnonymously();
    if (anonErr) throw anonErr;

    if (anonData.user) {
      return {
        userId: anonData.user.id,
        isCloud: true,
      };
    }

    throw new Error('Anonymous authentication did not return a user');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Supabase anonymous authentication failed';
    return {
      userId: getOrCreateLocalAnonId(),
      isCloud: false,
      error: message,
    };
  }
}

export function getOrCreateLocalAnonId(): string {
  const key = 'chess_training_anon_id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `anon-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(key, id);
  }
  return id;
}
