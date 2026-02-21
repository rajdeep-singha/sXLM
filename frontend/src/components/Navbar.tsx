import { useState, useRef, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { 
  Menu, 
  X, 
  ChevronDown, 
  BarChart3, 
  Landmark, 
  Vote, 
  TrendingUp, 
  Layers,
  ArrowRight,
  Sparkles
} from 'lucide-react';
import WalletButton from './WalletButton';

const NAV_LINKS = [
  { path: '/', label: 'Home' },
  { path: '/stake', label: 'Stake' },
  { path: '/withdraw', label: 'Withdraw' },
  { path: '/validators', label: 'Validators' },
  { path: '/liquidity', label: 'Liquidity' },
];

const DROPDOWN_LINKS = [
  { 
    path: '/analytics', 
    label: 'Analytics', 
    description: 'Protocol metrics & insights',
    icon: BarChart3,
    color: 'yellow'
  },
  { 
    path: '/lending', 
    label: 'Lending', 
    description: 'Borrow against your sXLM',
    icon: Landmark,
    color: 'yellow'
  },
  { 
    path: '/governance', 
    label: 'Governance', 
    description: 'Vote on protocol decisions',
    icon: Vote,
    color: 'yellow'
  },
  { 
    path: '/leverage', 
    label: 'Leverage', 
    description: 'Amplify your positions',
    icon: TrendingUp,
    color: 'yellow'
  },
  { 
    path: '/restaking', 
    label: 'Restaking', 
    description: 'Maximize staking rewards',
    icon: Layers,
    color: 'yellow'
  },
];

export default function Navbar() {
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isMobileDropdownOpen, setIsMobileDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const isDropdownActive = DROPDOWN_LINKS.some(link => location.pathname === link.path);

  const handleMouseEnter = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setIsDropdownOpen(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    timeoutRef.current = setTimeout(() => {
      setIsDropdownOpen(false);
    }, 150);
  }, []);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-black/90 backdrop-blur-sm border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          <Link to="/" className="flex items-center">
            <img src="/logo.png" alt="Logo" className="h-8 w-auto" />
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

            <div 
              className="relative" 
              ref={dropdownRef}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
            >
              <button
                className={`flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium transition-all duration-200 ${
                  isDropdownActive || isDropdownOpen
                    ? 'text-white bg-white/10'
                    : 'text-neutral-500 hover:text-white'
                }`}
              >
                Features
                <ChevronDown 
                  className={`w-3 h-3 transition-transform duration-300 ease-out ${
                    isDropdownOpen ? 'rotate-180' : ''
                  }`} 
                />
              </button>

              <div 
                className={`absolute top-full right-0 pt-4 transition-all duration-300 ease-out ${
                  isDropdownOpen 
                    ? 'opacity-100 translate-y-0 visible' 
                    : 'opacity-0 -translate-y-3 invisible pointer-events-none'
                }`}
              >
                <div className="w-[580px] bg-gradient-to-br from-neutral-900 via-black to-neutral-900 border border-white/10 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden">
                  <div className="p-5">
                    <div className="flex gap-6">
                      {/* Left Column - Features */}
                      <div className="flex-1">
                        <p className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wider mb-3 px-1">
                          Features
                        </p>
                        <div className="space-y-1">
                          {DROPDOWN_LINKS.map((link, index) => {
                            const isActive = location.pathname === link.path;
                            const Icon = link.icon;
                            return (
                              <Link
                                key={link.path}
                                to={link.path}
                                onClick={() => setIsDropdownOpen(false)}
                                className={`group flex items-start gap-3 p-3 rounded-xl transition-all duration-200 ${
                                  isActive
                                    ? 'bg-white/10'
                                    : 'hover:bg-white/5'
                                }`}
                                style={{
                                  opacity: isDropdownOpen ? 1 : 0,
                                  transform: isDropdownOpen ? 'translateX(0)' : 'translateX(-10px)',
                                  transition: `all 0.3s ease-out ${index * 50}ms`,
                                }}
                              >
                                <div className={`p-2 rounded-lg bg-gradient-to-br ${link.color} shrink-0`}>
                                  <Icon className="w-4 h-4 text-white" />
                                </div>
                                <div className="min-w-0">
                                  <p className={`text-sm font-medium transition-colors ${
                                    isActive ? 'text-white' : 'text-neutral-300 group-hover:text-white'
                                  }`}>
                                    {link.label}
                                  </p>
                                  <p className="text-xs text-neutral-500 mt-0.5">
                                    {link.description}
                                  </p>
                                </div>
                              </Link>
                            );
                          })}
                        </div>
                      </div>

                      {/* Right Column - Featured Card */}
                      <div className="w-[200px] shrink-0">
                        <p className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wider mb-3 px-1">
                          Highlights
                        </p>
                        
                        <div className="rounded-xl bg-gradient-to-br from-yellow-500/20 via-black/20 to-white/10 border border-white/10 p-4 transition-all duration-300"
style={{
                            opacity: isDropdownOpen ? 1 : 0,
                            transform: isDropdownOpen ? 'translateY(0)' : 'translateY(10px)',
                            transition: 'all 0.4s ease-out 150ms',
                          }}
                        >
                          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-yellow-500 to-black-500 flex items-center justify-center mb-3">
                            <Sparkles className="w-4 h-4 text-white" />
                          </div>
                          <p className="text-sm font-semibold text-white mb-1">
                            Liquid Staking
                          </p>
                          <p className="text-xs text-neutral-400 leading-relaxed mb-3">
                            Stake XLM and receive sXLM while earning rewards.
                          </p>
                          <Link 
                            to="/stake" 
                            onClick={() => setIsDropdownOpen(false)}
                            className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-400 hover:text-blue-300 transition-colors"
                          >
                            Start staking
                            <ArrowRight className="w-3 h-3" />
                          </Link>
                        </div>

                        <Link
                          to="/analytics"
                          onClick={() => setIsDropdownOpen(false)}
                          className="mt-3 flex items-center gap-2 px-3 py-2.5 rounded-lg hover:bg-white/5 transition-colors group"
                          style={{
                            opacity: isDropdownOpen ? 1 : 0,
                            transition: 'all 0.3s ease-out 250ms',
                          }}
                        >
                          <span className="text-xs font-medium text-neutral-400 group-hover:text-white transition-colors">
                            View all analytics
                          </span>
                          <ArrowRight className="w-3 h-3 text-neutral-500 group-hover:text-white group-hover:translate-x-0.5 transition-all" />
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
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

            <button
              onClick={() => setIsMobileDropdownOpen(!isMobileDropdownOpen)}
              className={`flex items-center justify-between w-full px-3 py-2 rounded text-sm ${
                isDropdownActive ? 'text-white bg-white/10' : 'text-neutral-500 hover:text-white'
              }`}
            >
              Features
              <ChevronDown className={`w-4 h-4 transition-transform ${isMobileDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {isMobileDropdownOpen && (
              <div className="pl-2 space-y-1 mt-1">
                {DROPDOWN_LINKS.map((link) => {
                  const isActive = location.pathname === link.path;
                  const Icon = link.icon;
                  return (
                    <Link
                      key={link.path}
                      to={link.path}
                      onClick={() => {
                        setIsMobileMenuOpen(false);
                        setIsMobileDropdownOpen(false);
                      }}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg ${
                        isActive ? 'text-white bg-white/10' : 'text-neutral-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <div className={`p-1.5 rounded-md bg-gradient-to-br ${link.color}`}>
                        <Icon className="w-3.5 h-3.5 text-white" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">{link.label}</p>
                        <p className="text-xs text-neutral-500">{link.description}</p>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}

            <div className="pt-3 border-t border-border">
              <WalletButton />
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
