import { useState, useEffect, createContext, useContext, useRef } from 'react';
import { toast } from '@/hooks/use-toast';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: any }>;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Set just before a sign-out the person asked for, so it isn't reported as an expired sign-in
let manualSignOutAt = 0;
export function markManualSignOut() { manualSignOutAt = Date.now(); }

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  // Tells a sign-out the person asked for apart from an expired sign-in
  const signingOut = useRef(false);
  const hadUser = useRef(false);

  useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === 'SIGNED_OUT' && hadUser.current && !signingOut.current && Date.now() - manualSignOutAt > 10000) {
          toast({
            title: 'Your sign-in has expired',
            description: 'Please sign in again. Bills already saved are safe.',
            variant: 'warning',
          });
        }
        if (event === 'SIGNED_OUT') signingOut.current = false;
        hadUser.current = !!session?.user;
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
      }
    );

    // THEN check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      hadUser.current = hadUser.current || !!session?.user;
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signUp = async (email: string, password: string, fullName: string) => {
    const redirectUrl = `${window.location.origin}/`;
    
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: {
          full_name: fullName,
        },
      },
    });

    // Create default user role for new signups  
    if (!error && data.user) {
      try {
        await supabase
          .from('user_roles')
          .insert({
            user_id: data.user.id,
            role: 'cashier'
          });
        
      } catch (inviteError) {
        console.log('No invitation found for this email, continuing...');
      }
    }

    return { error };
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error };
  };

  const signOut = async () => {
    signingOut.current = true;
    try {
      await supabase.auth.signOut();
    } finally {
      // In case no sign-out event arrives (e.g. offline)
      window.setTimeout(() => { signingOut.current = false; }, 3000);
    }
  };

  const value = {
    user,
    session,
    signUp,
    signIn,
    signOut,
    loading,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}