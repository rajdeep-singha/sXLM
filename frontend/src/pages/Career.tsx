import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, MapPin, Clock, X, CheckCircle2, Loader2, Briefcase } from 'lucide-react';
import LogoIcon from '../components/LogoIcon';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

/* ──────────────────────────────────────────────────────────────────────────
 * Job openings
 *
 * TODO: replace these placeholder roles with the real list. Each opening's
 * `title` is stored on the application row so you know which role was applied
 * to. `id` just needs to be unique/stable.
 * ────────────────────────────────────────────────────────────────────────── */
interface Opening {
  id: string;
  title: string;
  department: string;
  location: string;
  type: string;
  description: string;
}

const OPENINGS: Opening[] = [
  {
    id: 'video-editor',
    title: 'Video Editor',
    department: 'Content',
    location: 'Remote',
    type: 'Full-time',
    description:
      'Edit crisp, engaging videos for StelloFi — explainers, product walkthroughs, and social content that make DeFi on Stellar easy to understand.',
  },
];

interface FormState {
  full_name: string;
  email: string;
  phone: string;
  linkedin_url: string;
  portfolio_url: string;
  cover_letter: string;
}

const EMPTY_FORM: FormState = {
  full_name: '',
  email: '',
  phone: '',
  linkedin_url: '',
  portfolio_url: '',
  cover_letter: '',
};

/* ── Application modal ── */
function ApplyModal({ opening, onClose }: { opening: Opening; onClose: () => void }) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string>('');

  const update = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSupabaseConfigured || !supabase) {
      setStatus('error');
      setError('Applications are not accepting submissions right now. Please try again later.');
      return;
    }

    setStatus('submitting');
    setError('');

    const { error: insertError } = await supabase.from('job_applications').insert({
      position_id: opening.id,
      position_title: opening.title,
      full_name: form.full_name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim() || null,
      linkedin_url: form.linkedin_url.trim() || null,
      portfolio_url: form.portfolio_url.trim() || null,
      cover_letter: form.cover_letter.trim() || null,
    });

    if (insertError) {
      setStatus('error');
      setError(insertError.message || 'Something went wrong. Please try again.');
      return;
    }
    setStatus('success');
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={onClose}
    >
      <div
        className="card w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <p className="text-xs text-black/40 uppercase tracking-wider mb-1">{opening.department}</p>
            <h2 className="text-xl font-medium text-black" style={{ letterSpacing: '-0.02em' }}>
              {opening.title}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 w-8 h-8 rounded-full border border-[#e5e5e5] bg-white flex items-center justify-center hover:bg-[#F5F5F5] transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4 text-black" />
          </button>
        </div>

        {status === 'success' ? (
          <div className="flex flex-col items-center text-center py-8">
            <CheckCircle2 className="w-12 h-12 text-green-600 mb-4" />
            <h3 className="text-lg font-medium text-black mb-2">Application received</h3>
            <p className="text-sm text-black/60 mb-6 max-w-xs">
              Thanks for applying to the {opening.title} role. We'll review your application and reach out if
              there's a fit.
            </p>
            <button onClick={onClose} className="btn">Done</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Full name *</label>
              <input className="input" required value={form.full_name} onChange={update('full_name')} placeholder="Jane Doe" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Email *</label>
                <input className="input" type="email" required value={form.email} onChange={update('email')} placeholder="jane@example.com" />
              </div>
              <div>
                <label className="label">Phone</label>
                <input className="input" value={form.phone} onChange={update('phone')} placeholder="+1 555 000 0000" />
              </div>
            </div>
            <div>
              <label className="label">LinkedIn / GitHub</label>
              <input className="input" value={form.linkedin_url} onChange={update('linkedin_url')} placeholder="https://linkedin.com/in/…" />
            </div>
            <div>
              <label className="label">Portfolio / Website</label>
              <input className="input" value={form.portfolio_url} onChange={update('portfolio_url')} placeholder="https://…" />
            </div>
            <div>
              <label className="label">Why do you want to join?</label>
              <textarea
                className="input min-h-[110px] resize-y"
                value={form.cover_letter}
                onChange={update('cover_letter')}
                placeholder="Tell us a bit about yourself and why this role…"
              />
            </div>

            {status === 'error' && (
              <p className="text-sm text-red-600">{error}</p>
            )}

            <button type="submit" className="btn w-full flex items-center justify-center gap-2" disabled={status === 'submitting'}>
              {status === 'submitting' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Submitting…
                </>
              ) : (
                <>Submit application</>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

/* ── Career page ── */
export default function Career() {
  const [selected, setSelected] = useState<Opening | null>(null);

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      {/* Hero */}
      <section className="px-6 pt-16 pb-12 border-b border-[#e5e5e5]">
        <div className="max-w-3xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white border border-[#e5e5e5] mb-6">
            <Briefcase className="w-3.5 h-3.5 text-black/60" />
            <span className="text-xs text-black/60">We're hiring</span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-medium text-black mb-4" style={{ letterSpacing: '-0.04em' }}>
            Build the future of DeFi on Stellar
          </h1>
          <p className="text-lg text-black/60 leading-relaxed">
            Join StelloFi and help make XLM productive. We're a small, focused team building
            trustworthy, non-custodial yield infrastructure on Stellar Soroban.
          </p>
        </div>
      </section>

      {/* Openings */}
      <section className="px-6 py-14">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-sm font-semibold text-black/40 uppercase tracking-wider">Open positions</h2>
            <span className="text-sm text-black/40">{OPENINGS.length} role{OPENINGS.length === 1 ? '' : 's'}</span>
          </div>

          {OPENINGS.length === 0 ? (
            <div className="card p-10 text-center">
              <p className="text-black/60">No open roles right now — check back soon.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {OPENINGS.map((o) => (
                <button
                  key={o.id}
                  onClick={() => setSelected(o)}
                  className="card w-full text-left p-5 sm:p-6 group flex items-start justify-between gap-4 hover:shadow-md transition-shadow"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-xs text-black/40 uppercase tracking-wider">{o.department}</span>
                    </div>
                    <h3 className="text-lg font-medium text-black mb-2" style={{ letterSpacing: '-0.02em' }}>{o.title}</h3>
                    <p className="text-sm text-black/60 leading-relaxed mb-3">{o.description}</p>
                    <div className="flex flex-wrap items-center gap-4 text-xs text-black/50">
                      <span className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> {o.location}</span>
                      <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> {o.type}</span>
                    </div>
                  </div>
                  <span className="flex-shrink-0 mt-1 flex items-center gap-1 text-sm font-medium text-black/70 group-hover:text-black transition-colors">
                    Apply
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Footer strip */}
      <footer className="border-t border-[#e5e5e5] px-6 py-10">
        <div className="max-w-3xl mx-auto flex items-center justify-between flex-wrap gap-4">
          <Link to="/" className="flex items-center gap-2" style={{ textDecoration: 'none' }}>
            <LogoIcon className="w-6 h-6 text-black" />
            <span className="text-lg font-medium text-black" style={{ letterSpacing: '-0.02em' }}>Stello</span>
          </Link>
          <p className="text-xs text-black/40">© 2026 Stello Protocol · Native XLM Liquid Staking</p>
        </div>
      </footer>

      {selected && <ApplyModal opening={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
