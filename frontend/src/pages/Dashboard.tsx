import HeroSection from '../components/HeroSection';
import InfoSection from '../components/InfoSection';
import BackedBySection from '../components/BackedBySection';
import UseCasesSection from '../components/UseCasesSection';
import { Link } from 'react-router-dom';
import LogoIcon from '../components/LogoIcon';

function Footer() {
  return (
    <footer className="border-t border-[#e5e5e5] bg-[#F5F5F5] px-6 py-16">
      <div className="max-w-[88rem] mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-12">
          <div className="md:col-span-1">
            <Link to="/" className="flex items-center gap-2 mb-4" style={{ textDecoration: 'none' }}>
              <LogoIcon className="w-6 h-6 text-black" />
              <span className="text-lg font-medium text-black" style={{ letterSpacing: '-0.02em' }}>Stello</span>
            </Link>
            <p className="text-sm text-black/50 leading-relaxed">
              Native XLM Liquid Staking<br />on Stellar · Soroban Smart Contracts
            </p>
          </div>
          {[
            { heading: 'Protocol', links: [['Stake', '/stake'], ['Withdraw', '/withdraw'], ['Analytics', '/analytics']] },
            { heading: 'DeFi', links: [['Lending', '/lending'], ['Liquidity', '/liquidity'], ['Leverage', '/leverage'], ['Restaking', '/restaking']] },
            { heading: 'Governance', links: [['Governance', '/governance'], ['Validators', '/validators']] },
          ].map((col) => (
            <div key={col.heading}>
              <p className="text-xs text-black/40 uppercase tracking-[0.12em] mb-4">{col.heading}</p>
              {col.links.map(([label, href]) => (
                <Link
                  key={href}
                  to={href}
                  className="block text-sm text-black/60 mb-2.5 hover:text-black transition-colors duration-200"
                  style={{ textDecoration: 'none' }}
                >
                  {label}
                </Link>
              ))}
            </div>
          ))}
        </div>
        <div className="border-t border-[#e5e5e5] pt-8 flex justify-between items-center flex-wrap gap-4">
          <p className="text-xs text-black/40">© 2026 Stello Protocol · Native XLM Liquid Staking</p>
          <span className="text-xs border border-[#e5e5e5] text-black/40 px-3 py-1 rounded-full">
            Stellar Mainnet 
          </span>
        </div>
      </div>
    </footer>
  );
}

export default function Dashboard() {
  return (
    <div className="flex flex-col bg-[#F5F5F5]">

      {/* ── Section 1: Hero (full viewport height) ── */}
      <div className="h-screen flex flex-col overflow-hidden">
        <HeroSection />
      </div>

      {/* ── Section 2: Info — "Meet sXLM" ── */}
      <InfoSection />

      {/* ── Section 3: Backed By ── */}
      <BackedBySection />

      {/* ── Section 4: Use Cases ── */}
      <UseCasesSection />

      {/* ── Footer ── */}
      <Footer />
    </div>
  );
}
