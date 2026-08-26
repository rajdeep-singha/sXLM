import { useState, useRef, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X, ArrowRight, ChevronDown } from 'lucide-react';
import LogoIcon from './LogoIcon';
import WalletButton from './WalletButton';

const NAV_LINKS = [
  { path: '/stake',      label: 'Stake'      },
  { path: '/lending',    label: 'Earn'       },
  { path: '/governance', label: 'Governance' },
  { path: '/docs',       label: 'Docs'       },
];

const MORE_LINKS = [
  { path: '/analytics', label: 'Analytics' },
  { path: '/liquidity', label: 'Liquidity' },
];

export default function Navbar() {
  const location = useLocation();
  const isHome = location.pathname === '/';
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isHome) return;
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [isHome]);

  useEffect(() => {
    setIsMobileOpen(false);
    setMoreOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const transparent = isHome && !scrolled;
  const isMoreActive = MORE_LINKS.some(l => location.pathname === l.path);

  return (
    <nav
      className="left-0 right-0 top-0 z-50 px-6 py-5 transition-all duration-300"
      style={{
        position: isHome ? 'absolute' : 'fixed',
        background: transparent ? 'transparent' : '#F5F5F5',
        borderBottom: transparent ? 'none' : '1px solid #e5e5e5',
      }}
    >
      <div className="max-w-[88rem] mx-auto flex items-center justify-between">

        {/* Left — logo */}
        <Link to="/" className="flex items-center gap-2 flex-shrink-0" style={{ textDecoration: 'none' }}>
          <LogoIcon className="w-7 h-7 text-black" />
          <span className="text-2xl font-medium tracking-tight text-black" style={{ letterSpacing: '-0.02em' }}>
            Stello
          </span>
        </Link>

        {/* Center — desktop links */}
        <div className="hidden md:flex items-center gap-8">
          {NAV_LINKS.map((link) => {
            const active = location.pathname === link.path || location.pathname.startsWith(link.path + '/');
            return (
              <Link
                key={link.path}
                to={link.path}
                className="text-base font-medium transition-colors duration-200"
                style={{ color: active ? '#000' : '#6b7280', textDecoration: 'none' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = '#000'; }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = '#6b7280'; }}
              >
                {link.label}
              </Link>
            );
          })}

          {/* More dropdown */}
          <div className="relative" ref={moreRef}>
            <button
              onClick={() => setMoreOpen(!moreOpen)}
              className="flex items-center gap-1 text-base font-medium transition-colors duration-200"
              style={{ color: isMoreActive || moreOpen ? '#000' : '#6b7280' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = '#000'; }}
              onMouseLeave={(e) => { if (!isMoreActive && !moreOpen) e.currentTarget.style.color = '#6b7280'; }}
            >
              More
              <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${moreOpen ? 'rotate-180' : ''}`} />
            </button>
            {moreOpen && (
              <div
                className="absolute top-full left-1/2 -translate-x-1/2 mt-3 w-44 rounded-2xl bg-white border border-[#e5e5e5] py-2 z-50"
                style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}
              >
                {MORE_LINKS.map((link) => {
                  const active = location.pathname === link.path;
                  return (
                    <Link
                      key={link.path}
                      to={link.path}
                      onClick={() => setMoreOpen(false)}
                      className="block px-4 py-2 text-sm transition-colors duration-150"
                      style={{
                        color: active ? '#000' : '#6b7280',
                        background: active ? '#F5F5F5' : 'transparent',
                        textDecoration: 'none',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = '#F5F5F5'; e.currentTarget.style.color = '#000'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = active ? '#F5F5F5' : 'transparent'; e.currentTarget.style.color = active ? '#000' : '#6b7280'; }}
                    >
                      {link.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right */}
        <div className="flex items-center gap-3">
          <div className="hidden md:block">
            <WalletButton />
          </div>
          <Link
            to="/stake"
            className="hidden md:inline-flex items-center gap-2 bg-black text-white text-base font-medium px-7 py-2.5 rounded-full hover:bg-gray-800 transition-colors duration-200"
            style={{ textDecoration: 'none' }}
          >
            Launch App
            <ArrowRight className="w-4 h-4" />
          </Link>
          <button
            onClick={() => setIsMobileOpen(!isMobileOpen)}
            className="md:hidden flex items-center justify-center w-9 h-9 rounded-full border border-[#e5e5e5] bg-white"
          >
            {isMobileOpen ? <X className="w-4 h-4 text-black" /> : <Menu className="w-4 h-4 text-black" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {isMobileOpen && (
        <div className="md:hidden absolute left-0 right-0 top-full border-t border-[#e5e5e5] bg-[#F5F5F5]" style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.06)' }}>
          <div className="px-6 py-4 space-y-1 max-w-[88rem] mx-auto">
            {[...NAV_LINKS, ...MORE_LINKS].map((link) => {
              const active = location.pathname === link.path;
              return (
                <Link
                  key={link.path}
                  to={link.path}
                  className="block px-3 py-2.5 rounded-xl text-base font-medium transition-colors duration-200"
                  style={{ color: active ? '#000' : '#6b7280', background: active ? 'rgba(0,0,0,0.04)' : 'transparent', textDecoration: 'none' }}
                >
                  {link.label}
                </Link>
              );
            })}
            <div className="pt-3 border-t border-[#e5e5e5] mt-3 flex flex-col gap-3">
              <WalletButton />
              <Link to="/stake" className="inline-flex items-center justify-center gap-2 bg-black text-white text-base font-medium px-7 py-2.5 rounded-full hover:bg-gray-800 transition-colors duration-200" style={{ textDecoration: 'none' }}>
                Launch App
              </Link>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
