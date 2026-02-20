import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import WalletButton from './WalletButton';

const NAV_LINKS = [
  { path: '/', label: 'Home' },
  { path: '/stake', label: 'Stake' },
  { path: '/withdraw', label: 'Withdraw' },
  { path: '/validators', label: 'Validators' },
  { path: '/analytics', label: 'Analytics' },
  { path: '/lending', label: 'Lending' },
  { path: '/liquidity', label: 'Liquidity' },
  { path: '/governance', label: 'Governance' },
  { path: '/leverage', label: 'Leverage' },
  { path: '/restaking', label: 'Restaking' },
];

export default function Navbar() {
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-black/90 backdrop-blur-sm border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          <Link to="/" className="text-sm font-bold tracking-wider text-white">
            sXLM
          </Link>

          <div className="hidden md:flex items-center gap-0.5">
            {NAV_LINKS.map((link) => {
              const isActive = location.pathname === link.path;
              return (
                <Link
                  key={link.path}
                  to={link.path}
                  className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                    isActive
                      ? 'text-white bg-white/10'
                      : 'text-neutral-500 hover:text-white'
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden md:block">
              <WalletButton />
            </div>
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="md:hidden p-1.5 text-neutral-400 hover:text-white"
            >
              {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {isMobileMenuOpen && (
        <div className="md:hidden bg-black border-b border-border">
          <div className="px-4 py-3 space-y-1">
            {NAV_LINKS.map((link) => {
              const isActive = location.pathname === link.path;
              return (
                <Link
                  key={link.path}
                  to={link.path}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={`block px-3 py-2 rounded text-sm ${
                    isActive ? 'text-white bg-white/10' : 'text-neutral-500 hover:text-white'
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
            <div className="pt-3 border-t border-border">
              <WalletButton />
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
