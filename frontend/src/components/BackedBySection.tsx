const BACKER_ITEMS = [
  { name: 'Stellar', style: { fontFamily: 'Georgia, serif', fontWeight: 700, letterSpacing: '-0.02em', fontSize: '18px' } },
  { name: 'Stellar Labs', style: { fontFamily: 'Helvetica, Arial, sans-serif', fontWeight: 700, letterSpacing: '0.02em', fontSize: '16px' } },
  { name: 'Stellar', style: { fontFamily: "'Trebuchet MS', sans-serif", fontWeight: 600, letterSpacing: '-0.01em', fontSize: '17px', fontStyle: 'italic' } },
  { name: 'Stellar Labs', style: { fontFamily: "'Palatino Linotype', serif", fontWeight: 500, letterSpacing: '0.04em', fontSize: '15px' } },
  { name: 'Stellar', style: { fontFamily: 'Verdana, sans-serif', fontWeight: 700, letterSpacing: '-0.03em', fontSize: '16px' } },
  { name: 'Stellar Labs', style: { fontFamily: "'Courier New', monospace", fontWeight: 700, letterSpacing: '0.10em', fontSize: '14px' } },
];

export default function BackedBySection() {
  return (
    <section className="bg-[#F5F5F5] px-6 py-12">
      <div className="max-w-[88rem] mx-auto grid grid-cols-1 md:grid-cols-4 gap-8 items-center">
        <div className="md:col-span-1">
          <p className="text-black/70 text-base leading-relaxed">
            Built on Stellar,<br />powered by Stellar Labs.
          </p>
        </div>
        <div className="md:col-span-3 overflow-hidden">
          <div className="backers-track">
            {[...BACKER_ITEMS, ...BACKER_ITEMS].map((backer, i) => (
              <span key={i} className="mx-10 shrink-0 text-black/50 whitespace-nowrap" style={backer.style}>
                {backer.name}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
