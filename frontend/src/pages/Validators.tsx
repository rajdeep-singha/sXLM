import ValidatorTable from '../components/ValidatorTable';
import { useProtocol } from '../hooks/useProtocol';

export default function Validators() {
  const { validators } = useProtocol();
  const avgScore = validators.length
    ? validators.reduce((sum, v) => sum + v.performanceScore, 0) / validators.length
    : 0;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-6">
      <div>
        <p className="text-[11px] uppercase tracking-widest mb-2 text-gray-400">Network</p>
        <h1 className="text-2xl font-semibold text-black mb-1" style={{ letterSpacing: '-0.02em' }}>Validators</h1>
        <p className="text-sm text-gray-500">Validators securing the sXLM protocol</p>
      </div>

      <div className="grid grid-cols-3 gap-px bg-[#e5e5e5] rounded-2xl overflow-hidden">
        <div className="bg-white p-5">
          <p className="stat-label">Total</p>
          <p className="stat-value mt-1">{validators.length}</p>
        </div>
        <div className="bg-white p-5">
          <p className="stat-label">Active</p>
          <p className="stat-value mt-1">{validators.filter(v => v.isActive).length}</p>
        </div>
        <div className="bg-white p-5">
          <p className="stat-label">Avg Score</p>
          <p className="stat-value mt-1">{avgScore.toFixed(1)}</p>
        </div>
      </div>

      <ValidatorTable />
    </div>
  );
}
