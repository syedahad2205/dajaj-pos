'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { createPosStaffRequest, getPosStaffProfile, getPosStaffProfileByEmail, setPosStaffUid } from '@/lib/firestore';

type Tab = 'login' | 'register';

export default function PosLoginPage() {
  const [tab, setTab] = useState<Tab>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setSuccess(''); setLoading(true);
    try {
      // Try to sign in with existing Firebase Auth account
      try {
        const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
        // Email-keyed lookup (new format) with fallback to UID-keyed (old format)
        const profile = await getPosStaffProfileByEmail(cred.user.email!)
                        ?? await getPosStaffProfile(cred.user.uid);
        if (!profile) {
          await signOut(auth);
          setError('No POS access for this account. Use "Request Access" first.');
          return;
        }
        if (profile.status === 'pending') {
          await signOut(auth);
          setError('Your account is pending admin approval. Please wait.');
          return;
        }
        if (profile.status === 'rejected') {
          await signOut(auth);
          setError('Your access request was rejected. Contact the admin.');
          return;
        }
        router.push('/pos');
      } catch (authErr: unknown) {
        const authMsg = authErr instanceof Error ? authErr.message : '';
        const isNotFound = authMsg.includes('user-not-found') || authMsg.includes('invalid-credential') || authMsg.includes('INVALID_LOGIN_CREDENTIALS') || authMsg.includes('invalid-login-credentials');
        if (!isNotFound) throw authErr;

        // No Firebase Auth account yet — check if they have an approved request
        const profile = await getPosStaffProfileByEmail(email.trim());
        if (!profile) {
          setError('No POS request found for this email. Use "Request Access" to apply.');
          return;
        }
        if (profile.status === 'pending') {
          setError('Your request is pending admin approval. Please wait.');
          return;
        }
        if (profile.status === 'rejected') {
          setError('Your access request was rejected. Contact the admin.');
          return;
        }
        if (profile.status === 'active') {
          // First login after approval — create Firebase Auth account with this password
          const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
          await setPosStaffUid(email.trim(), cred.user.uid);
          router.push('/pos');
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('weak-password')) {
        setError('Password must be at least 6 characters.');
      } else if (msg.includes('email-already-in-use')) {
        setError('Account already exists. Try logging in directly.');
      } else {
        setError(msg || 'Login failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setSuccess(''); setLoading(true);
    try {
      await createPosStaffRequest(name.trim(), email.trim());
      setSuccess('Request submitted! An admin will review and approve your account.');
      setName(''); setEmail('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('permission-denied')) {
        setError('Permission denied — contact the admin.');
      } else {
        setError(msg || 'Failed to submit request. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-100 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-8">
        {/* Logo / Brand */}
        <div className="text-center mb-6">
          <p className="text-2xl font-extrabold text-neutral-900">DAJAJ POS</p>
          <p className="text-sm text-neutral-400 mt-1">Staff Access</p>
        </div>

        {/* Tabs */}
        <div className="flex rounded-xl bg-neutral-100 p-1 mb-6">
          {(['login', 'register'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setError(''); setSuccess(''); }}
              className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${
                tab === t ? 'bg-white shadow text-neutral-900' : 'text-neutral-500 hover:text-neutral-700'
              }`}
            >
              {t === 'login' ? 'Login' : 'Request Access'}
            </button>
          ))}
        </div>

        {tab === 'login' ? (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="mt-1 w-full px-3 py-2.5 rounded-xl border border-neutral-300 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="mt-1 w-full px-3 py-2.5 rounded-xl border border-neutral-300 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                placeholder="••••••"
              />
            </div>
            {error && <p className="text-sm text-red-600 font-medium">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-xl text-sm transition-colors disabled:opacity-50"
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
            <p className="text-xs text-neutral-400 text-center">
              First login after approval? Enter your email and choose a password.
            </p>
          </form>
        ) : (
          <form onSubmit={handleRegister} className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Your Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="mt-1 w-full px-3 py-2.5 rounded-xl border border-neutral-300 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                placeholder="Full name"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="mt-1 w-full px-3 py-2.5 rounded-xl border border-neutral-300 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                placeholder="you@example.com"
              />
            </div>
            {error && <p className="text-sm text-red-600 font-medium">{error}</p>}
            {success && <p className="text-sm text-green-600 font-medium">{success}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-xl text-sm transition-colors disabled:opacity-50"
            >
              {loading ? 'Submitting…' : 'Request Access'}
            </button>
            <p className="text-xs text-neutral-400 text-center">
              Your request will be reviewed by an admin before you can log in.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
