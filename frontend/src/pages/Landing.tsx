/**
 * Landing Page — sXLM Protocol
 * 
 * A beautiful hero landing page without navbar.
 * Users click "Launch App" to enter the main application.
 */

import { Link } from 'react-router-dom';
import { ArrowRight, Shield, Zap, TrendingUp, Users, ChevronDown } from 'lucide-react';
import DotGrid from '../components/DotGrid';
import { PixelBlast } from '../components/GradientText';

const Y = '#F5CF00'; // Stellar yellow

function StellarMark({ size = 32, color = "#F5C542" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M8 38C16 48 32 50 56 34C40 46 24 44 8 38Z" fill={color} opacity="0.6" />
      <path d="M8 32C20 40 38 38 56 24C40 34 24 36 8 32Z" fill={color} opacity="0.85" />
      <path d="M8 26C22 32 40 28 56 14C40 22 24 26 8 26Z" fill={color} />
      <path d="M46 8L49 14L56 16L49 18L46 24L43 18L36 16L43 14L46 8Z" fill="white" />
    </svg>
  );
}



const FEATURES = [
  {
    icon: Shield,
    title: 'Secure Staking',
    description: 'Non-custodial liquid staking with battle-tested smart contracts on Stellar.',
  },
  {
    icon: Zap,
    title: 'Instant Liquidity',
    description: 'Receive sXLM tokens immediately. Use them across DeFi while earning rewards.',
  },
  {
    icon: TrendingUp,
    title: 'Maximize Yields',
    description: 'Leverage, lend, and restake your sXLM to compound your earnings.',
  },
  {
    icon: Users,
    title: 'Decentralized',
    description: 'Governed by the community. Vote on protocol decisions with your stake.',
  },
];

const STATS = [
  { label: 'Total Value Locked', value: '$2.4M+' },
  { label: 'Current APY', value: '~5.2%' },
  { label: 'Validators', value: '15+' },
  { label: 'Active Stakers', value: '1,200+' },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-black text-white overflow-hidden">
      {/* Animated Background - DotGrid + PixelBlast */}
      <div className="fixed inset-0">
        {/* Base dot grid */}
        <DotGrid 
          dotSize={4}
          gap={18}
          baseColor="#4a4a4a"
          activeColor={Y}
          proximity={120}
        />
        {/* Particle effect overlay */}
        <PixelBlast 
          particleCount={150}
          colors={['#F5CF00', '#FFD700', '#FFA500', '#E6B800', '#FFED4A', '#D4A800']}
          interactive={true}
        />
        {/* Radial vignette overlay */}
        <div 
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `radial-gradient(ellipse at center, transparent 0%, rgba(0,0,0,0.7) 100%)`,
          }}
        />
      </div>

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-6 md:px-12 py-6">
        <div className="flex items-center gap-3">
          <StellarMark size={40} />
          <span className="text-xl font-bold tracking-tight">sXLM</span>
        </div>
        <Link
          to="/stake"
          className="hidden sm:flex items-center gap-2 px-5 py-2.5 bg-white text-black font-semibold text-sm rounded-full hover:bg-neutral-200 transition-colors"
        >
          Launch App
          <ArrowRight className="w-4 h-4" />
        </Link>
      </header>

      {/* Hero Section */}
      <section className="relative z-10 px-6 md:px-12 pt-16 md:pt-24 pb-20">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col lg:flex-row items-center gap-12">
            {/* Left side - Text content */}
            <div className="flex-1 text-center lg:text-left">
              {/* Badge */}
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 mb-8">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-sm text-neutral-400">Live on Stellar Testnet</span>
              </div>

              {/* Main headline */}
              <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight mb-6 leading-[1.1]">
                Liquid Staking for{' '}
                <span 
                  className="bg-clip-text text-transparent"
                  style={{ backgroundImage: `linear-gradient(135deg, ${Y} 0%, #fff 100%)` }}
                >
                  Stellar
                </span>
              </h1>

              <p className="text-lg md:text-xl text-neutral-400 max-w-xl mb-10 leading-relaxed">
                Stake your XLM, receive sXLM, and unlock the full potential of DeFi 
                while earning staking rewards. No lockups, full liquidity.
              </p>

              {/* CTA Buttons */}
              <div className="flex flex-col sm:flex-row items-center lg:items-start justify-center lg:justify-start gap-4 mb-12">
                <Link
                  to="/stake"
                  className="flex items-center gap-2 px-8 py-4 bg-white text-black font-semibold rounded-full hover:bg-neutral-200 transition-all hover:scale-105"
                >
                  Start Staking
                  <ArrowRight className="w-5 h-5" />
                </Link>
                <Link
                  to="/analytics"
                  className="flex items-center gap-2 px-8 py-4 bg-white/5 border border-white/10 font-semibold rounded-full hover:bg-white/10 transition-colors"
                >
                  View Analytics
                </Link>
              </div>

              {/* Stats Strip */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6 max-w-xl">
                {STATS.map((stat) => (
                  <div key={stat.label} className="text-center lg:text-left">
                    <p className="text-2xl md:text-3xl font-bold" style={{ color: Y }}>
                      {stat.value}
                    </p>
                    <p className="text-xs md:text-sm text-neutral-500 mt-1">{stat.label}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Right side - Stello Mascot */}
            <div className="flex-1 flex justify-center lg:justify-end">
              <div className="relative">
                {/* Glow effect behind mascot */}
                <div 
                  className="absolute inset-0 blur-3xl opacity-40"
                  style={{
                    background: `radial-gradient(circle, ${Y}40 0%, transparent 70%)`,
                    transform: 'scale(1.2)',
                  }}
                />
                {/* Mascot with floating animation */}
                <img 
                  src="/stello1.png" 
                  alt="Stello - sXLM Mascot" 
                  className="relative w-64 md:w-80 lg:w-96 h-auto drop-shadow-2xl"
                  style={{
                    animation: 'float 4s ease-in-out infinite',
                    filter: `drop-shadow(0 0 30px ${Y}40)`,
                  }}
                />
                {/* Sparkle effects */}
                <div 
                  className="absolute top-10 right-10 w-3 h-3 rounded-full"
                  style={{
                    background: Y,
                    boxShadow: `0 0 10px ${Y}, 0 0 20px ${Y}`,
                    animation: 'sparkle 2s ease-in-out infinite',
                  }}
                />
                <div 
                  className="absolute bottom-20 left-5 w-2 h-2 rounded-full"
                  style={{
                    background: Y,
                    boxShadow: `0 0 8px ${Y}, 0 0 16px ${Y}`,
                    animation: 'sparkle 2.5s ease-in-out infinite 0.5s',
                  }}
                />
                <div 
                  className="absolute top-1/2 right-0 w-2 h-2 rounded-full"
                  style={{
                    background: '#fff',
                    boxShadow: `0 0 8px #fff, 0 0 16px ${Y}`,
                    animation: 'sparkle 3s ease-in-out infinite 1s',
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
          <ChevronDown className="w-6 h-6 text-neutral-600" />
        </div>

        {/* CSS Animations */}
        <style>{`
          @keyframes float {
            0%, 100% {
              transform: translateY(0px);
            }
            50% {
              transform: translateY(-20px);
            }
          }
          @keyframes sparkle {
            0%, 100% {
              opacity: 1;
              transform: scale(1);
            }
            50% {
              opacity: 0.5;
              transform: scale(0.5);
            }
          }
        `}</style>
      </section>

      {/* Features Section */}
      <section className="relative z-10 px-6 md:px-12 py-20 bg-gradient-to-b from-transparent via-neutral-950/50 to-transparent">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Why sXLM?</h2>
            <p className="text-neutral-400 max-w-xl mx-auto">
              The most efficient way to earn staking rewards on Stellar while maintaining full liquidity.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {FEATURES.map((feature, i) => {
              const Icon = feature.icon;
              return (
                <div
                  key={feature.title}
                  className="group p-6 rounded-2xl bg-neutral-900/50 border border-white/5 hover:border-white/10 transition-all hover:-translate-y-1"
                  style={{ animationDelay: `${i * 100}ms` }}
                >
                  <div 
                    className="w-12 h-12 rounded-xl flex items-center justify-center mb-4"
                    style={{ background: `linear-gradient(135deg, ${Y}20 0%, ${Y}05 100%)` }}
                  >
                    <Icon className="w-6 h-6" style={{ color: Y }} />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">{feature.title}</h3>
                  <p className="text-sm text-neutral-500 leading-relaxed">{feature.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* How it Works Section */}
      <section className="relative z-10 px-6 md:px-12 py-20">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">How It Works</h2>
            <p className="text-neutral-400">Three simple steps to start earning.</p>
          </div>

          <div className="space-y-8">
            {[
              { step: '01', title: 'Connect Wallet', desc: 'Connect your Freighter wallet to get started.' },
              { step: '02', title: 'Stake XLM', desc: 'Deposit XLM and receive sXLM tokens instantly.' },
              { step: '03', title: 'Earn & Use', desc: 'Earn staking rewards while using sXLM in DeFi.' },
            ].map((item, i) => (
              <div 
                key={item.step}
                className="flex items-start gap-6 p-6 rounded-2xl bg-neutral-900/30 border border-white/5"
              >
                <span 
                  className="text-4xl font-bold opacity-30"
                  style={{ color: Y }}
                >
                  {item.step}
                </span>
                <div>
                  <h3 className="text-xl font-semibold mb-1">{item.title}</h3>
                  <p className="text-neutral-500">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Final CTA */}
          <div className="text-center mt-16">
            <Link
              to="/stake"
              className="inline-flex items-center gap-2 px-10 py-4 text-lg font-semibold rounded-full transition-all hover:scale-105"
              style={{ background: Y, color: '#000' }}
            >
              Launch App
              <ArrowRight className="w-5 h-5" />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 px-6 md:px-12 py-12 border-t border-white/5">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <StellarMark size={32} />
            <span className="font-semibold">sXLM Protocol</span>
          </div>
          <p className="text-sm text-neutral-600">
            Built on Stellar. Powered by the community.
          </p>
          <div className="flex items-center gap-6">
            <a href="#" className="text-sm text-neutral-500 hover:text-white transition-colors">Docs</a>
            <a href="#" className="text-sm text-neutral-500 hover:text-white transition-colors">GitHub</a>
            <a href="#" className="text-sm text-neutral-500 hover:text-white transition-colors">Twitter</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
