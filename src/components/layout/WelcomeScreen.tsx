import React, { useState } from 'react';
import { ArrowRight, LogIn, UserPlus, Globe, ArrowLeft, CheckCircle2 } from 'lucide-react';

interface WelcomeScreenProps {
  onEnterAsGuest: () => void;
  isAuthAvailable?: boolean;
  onSignIn?: (identifier: string, password: string) => Promise<void>;
  onSignUp?: (
    email: string,
    password: string,
    username: string
  ) => Promise<{ needsEmailConfirmation?: boolean; username: string }>;
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
  onEnterAsGuest,
  isAuthAvailable = false,
  onSignIn,
  onSignUp,
}) => {
  const [authMode, setAuthMode] = useState<'none' | 'login' | 'signup'>('none');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAuthAvailable) return;
    setAuthError(null);
    setAuthNotice(null);
    setSubmitting(true);
    try {
      if (authMode === 'login' && onSignIn) {
        await onSignIn(loginIdentifier.trim(), password);
      } else if (authMode === 'signup' && onSignUp) {
        const cleanUser = username.trim();
        const cleanEmail = email.trim();
        const res = await onSignUp(cleanEmail, password, cleanUser);

        // Redirect directly to the login screen with username pre-filled!
        setAuthMode('login');
        setLoginIdentifier(res.username || cleanUser);
        setPassword('');
        setAuthNotice('Account created successfully! Please enter your password to sign in.');
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#080F1E] text-[#F1F5F9] flex flex-col items-center justify-center px-4 py-10 sm:px-6">
      <div className="w-full max-w-[460px] flex flex-col items-center text-center">
        {/* CTG Logo */}
        <div className="w-20 h-20 sm:w-24 sm:h-24 flex items-center justify-center mb-6">
          <img
            src="/assets/aistudio/Add_a_heading__16_-removebg-preview_c70fa2ca.png"
            alt="Chess Tactics Guide logo"
            className="w-full h-full object-contain"
          />
        </div>

        {/* WELCOME Heading */}
        <h1 className="font-heading text-4xl sm:text-5xl font-bold tracking-wider text-[#F1F5F9] leading-none">
          WELCOME
        </h1>

        {/* Website Name */}
        <h2 className="mt-3 font-heading text-2xl sm:text-3xl font-bold tracking-tight text-[#F1F5F9] leading-snug">
          Chess Tactics Guide
        </h2>

        {/* Slogan */}
        <p className="mt-2 font-ui text-lg sm:text-xl font-semibold text-[#39FF88]">
          Improve Your Chess
        </p>

        {/* Access Options Card */}
        <div className="mt-8 w-full bg-[#101B30] border border-[#263D5C] rounded-2xl p-5 sm:p-6 space-y-3 shadow-2xl">
          {authMode === 'none' ? (
            <>
              {/* Play as Guest */}
              <button
                type="button"
                onClick={onEnterAsGuest}
                className="w-full py-3.5 px-5 rounded-xl bg-[#39FF88] hover:bg-[#52FF99] text-[#080F1E] font-ui text-base sm:text-lg font-bold flex items-center justify-center gap-2 transition-colors duration-150 cursor-pointer whitespace-nowrap"
              >
                <span>Play as Guest</span>
                <ArrowRight className="w-5 h-5 shrink-0" />
              </button>

              <div className="pt-1 border-t border-[#263D5C]/80" />

              {isAuthAvailable ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthError(null);
                      setAuthNotice(null);
                      setAuthMode('login');
                    }}
                    className="w-full py-3.5 px-4 rounded-xl bg-[#14233A] hover:bg-[#192C47] border border-[#263D5C] hover:border-[#39FF88]/50 text-[#F1F5F9] font-ui text-base font-semibold flex items-center justify-center gap-2.5 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <LogIn className="w-4 h-4 text-[#39FF88] shrink-0" />
                    <span>Sign In</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setAuthError(null);
                      setAuthNotice(null);
                      setAuthMode('signup');
                    }}
                    className="w-full py-3.5 px-4 rounded-xl bg-[#14233A] hover:bg-[#192C47] border border-[#263D5C] hover:border-[#39FF88]/50 text-[#F1F5F9] font-ui text-base font-semibold flex items-center justify-center gap-2.5 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <UserPlus className="w-4 h-4 text-[#39FF88] shrink-0" />
                    <span>Create Account</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    disabled
                    aria-disabled="true"
                    className="w-full py-3.5 px-4 rounded-xl bg-[#14233A]/70 border border-[#263D5C]/80 text-[#94A3B8] font-ui text-base font-medium flex items-center justify-between gap-3 opacity-80 cursor-not-allowed whitespace-nowrap"
                  >
                    <span className="inline-flex items-center gap-2.5 text-[#F1F5F9]/75">
                      <LogIn className="w-4 h-4 text-[#94A3B8] shrink-0" />
                      <span>Sign In</span>
                    </span>
                    <span className="text-xs sm:text-sm font-medium text-[#94A3B8]">Coming Soon</span>
                  </button>

                  <button
                    type="button"
                    disabled
                    aria-disabled="true"
                    className="w-full py-3.5 px-4 rounded-xl bg-[#14233A]/70 border border-[#263D5C]/80 text-[#94A3B8] font-ui text-base font-medium flex items-center justify-between gap-3 opacity-80 cursor-not-allowed whitespace-nowrap"
                  >
                    <span className="inline-flex items-center gap-2.5 text-[#F1F5F9]/75">
                      <UserPlus className="w-4 h-4 text-[#94A3B8] shrink-0" />
                      <span>Create Account</span>
                    </span>
                    <span className="text-xs sm:text-sm font-medium text-[#94A3B8]">Coming Soon</span>
                  </button>
                </>
              )}

              <button
                type="button"
                disabled
                aria-disabled="true"
                className="w-full py-3.5 px-4 rounded-xl bg-[#14233A]/70 border border-[#263D5C]/80 text-[#94A3B8] font-ui text-base font-medium flex items-center justify-between gap-3 opacity-80 cursor-not-allowed whitespace-nowrap"
              >
                <span className="inline-flex items-center gap-2.5 text-[#F1F5F9]/75">
                  <Globe className="w-4 h-4 text-[#94A3B8] shrink-0" />
                  <span>Sign In with Lichess</span>
                </span>
                <span className="text-xs sm:text-sm font-medium text-[#94A3B8]">Coming Soon</span>
              </button>
            </>
          ) : (
            <form onSubmit={handleAuthSubmit} className="space-y-4 text-left">
              <div className="flex items-center justify-between pb-1 border-b border-[#263D5C]/60">
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('none');
                    setAuthError(null);
                    setAuthNotice(null);
                  }}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#94A3B8] hover:text-[#F1F5F9] cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back
                </button>
                <span className="font-heading text-lg font-bold text-[#F1F5F9]">
                  {authMode === 'login' ? 'Sign In' : 'Create Account'}
                </span>
              </div>

              {authMode === 'signup' ? (
                <>
                  {/* SIGN UP: Username, Email, Password */}
                  <div>
                    <label className="block text-sm font-semibold text-[#CBD5E1] mb-1.5">
                      Username
                    </label>
                    <input
                      type="text"
                      required
                      minLength={3}
                      maxLength={30}
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="e.g. magnus123"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#080F1E] border border-[#263D5C] text-base text-[#F1F5F9] focus:outline-none focus:border-[#39FF88]"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-[#CBD5E1] mb-1.5">
                      Email Address
                    </label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#080F1E] border border-[#263D5C] text-base text-[#F1F5F9] focus:outline-none focus:border-[#39FF88]"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-[#CBD5E1] mb-1.5">
                      Password
                    </label>
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="At least 6 characters"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#080F1E] border border-[#263D5C] text-base text-[#F1F5F9] focus:outline-none focus:border-[#39FF88]"
                    />
                  </div>
                </>
              ) : (
                <>
                  {/* LOGIN: Username or Email, Password */}
                  <div>
                    <label className="block text-sm font-semibold text-[#CBD5E1] mb-1.5">
                      Username or Email
                    </label>
                    <input
                      type="text"
                      required
                      value={loginIdentifier}
                      onChange={(e) => setLoginIdentifier(e.target.value)}
                      placeholder="Enter username or email"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#080F1E] border border-[#263D5C] text-base text-[#F1F5F9] focus:outline-none focus:border-[#39FF88]"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-[#CBD5E1] mb-1.5">
                      Password
                    </label>
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#080F1E] border border-[#263D5C] text-base text-[#F1F5F9] focus:outline-none focus:border-[#39FF88]"
                    />
                  </div>
                </>
              )}

              {authError && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm font-medium">
                  {authError}
                </div>
              )}

              {authNotice && (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-[#39FF88] text-sm font-medium flex items-start gap-2">
                  <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
                  <span>{authNotice}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3.5 px-5 rounded-xl bg-[#39FF88] hover:bg-[#52FF99] text-[#080F1E] font-ui text-base font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-60"
              >
                {submitting
                  ? 'Please wait...'
                  : authMode === 'login'
                  ? 'Sign In'
                  : 'Create Account'}
              </button>

              <div className="text-center pt-2">
                {authMode === 'login' ? (
                  <button
                    type="button"
                    onClick={() => {
                      setAuthError(null);
                      setAuthNotice(null);
                      setAuthMode('signup');
                    }}
                    className="text-sm text-[#94A3B8] hover:text-[#39FF88] transition-colors cursor-pointer"
                  >
                    Don't have an account? <span className="font-semibold underline text-[#F1F5F9]">Sign up</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setAuthError(null);
                      setAuthNotice(null);
                      setAuthMode('login');
                    }}
                    className="text-sm text-[#94A3B8] hover:text-[#39FF88] transition-colors cursor-pointer"
                  >
                    Already have an account? <span className="font-semibold underline text-[#F1F5F9]">Sign in</span>
                  </button>
                )}
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
