import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

const BRAND_ITEMS = [
  { name: 'Stellar', style: { fontFamily: 'Georgia, serif', fontWeight: 700, letterSpacing: '-0.02em', fontSize: '16px' } },
  { name: 'Stellar Labs', style: { fontFamily: 'Helvetica, Arial, sans-serif', fontWeight: 700, letterSpacing: '0.02em', fontSize: '14px' } },
  { name: 'Stellar', style: { fontFamily: "'Trebuchet MS', sans-serif", fontWeight: 600, letterSpacing: '0.01em', fontSize: '15px', fontStyle: 'italic' } },
  { name: 'Stellar Labs', style: { fontFamily: "'Palatino Linotype', 'Book Antiqua', serif", fontWeight: 400, letterSpacing: '-0.01em', fontSize: '16px' } },
  { name: 'Stellar', style: { fontFamily: 'Verdana, sans-serif', fontWeight: 700, letterSpacing: '-0.03em', fontSize: '14px' } },
  { name: 'Stellar Labs', style: { fontFamily: "'Courier New', monospace", fontWeight: 700, letterSpacing: '0.10em', fontSize: '13px' } },
];

export default function HeroSection() {
  return (
    <div className="flex-1 px-4 sm:px-6 pt-20 pb-6 flex items-end">
      <div
        className="relative w-full rounded-2xl overflow-hidden"
        style={{ height: 'calc(100vh - 96px)' }}
      >
        {/* Background video */}
        <video autoPlay muted loop playsInline className="absolute inset-0 w-full h-full object-cover">
          <source src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260423_161253_c72b1869-400f-45ed-ac0c-52f68c2ed5bd.mp4" type="video/mp4" />
        </video>

        {/* Content overlay */}
        <div className="relative z-10 flex flex-col items-start justify-start h-full p-6 sm:p-12 pt-24 sm:pt-36">
          <h1
            className="text-black text-4xl sm:text-5xl md:text-6xl font-medium leading-tight max-w-xl mb-4"
            style={{ letterSpacing: '-0.04em' }}
          >
            Your XLM<br />Works
          </h1>
          <p
            className="text-black/70 text-base md:text-lg max-w-md mb-8 leading-relaxed"
            style={{ fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif" }}
          >
            A yield-bearing XLM vault that issues sXLM , a composable share token
            backed by pooled XLM and conservative Stellar DeFi strategies.
          </p>
          <Link
            to="/stake"
            className="inline-flex items-center gap-3 bg-black text-white text-base md:text-lg font-medium pl-8 pr-2 py-2 rounded-full hover:bg-gray-800 transition-colors duration-200 mb-8"
            style={{ textDecoration: 'none' }}
          >
            Get Started
            <span className="bg-white rounded-full p-2 flex items-center justify-center">
              <ArrowRight className="w-5 h-5 text-black" />
            </span>
          </Link>
          <div className="mt-10 sm:mt-16 w-full max-w-md overflow-hidden">
            <div className="marquee-track">
              {[...BRAND_ITEMS, ...BRAND_ITEMS].map((brand, i) => (
                <span key={i} className="mx-7 shrink-0 text-black/60 whitespace-nowrap" style={brand.style}>
                  {brand.name}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
