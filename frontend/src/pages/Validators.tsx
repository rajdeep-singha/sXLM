import ValidatorTable from '../components/ValidatorTable';
import { useProtocol } from '../hooks/useProtocol';

export default function Validators() {
  const { validators } = useProtocol();
  const avgScore = validators.length
    ? validators.reduce((sum, v) => sum + v.performanceScore, 0) / validators.length
    : 0;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-1">Validators</h1>
        <p className="text-neutral-500 text-sm">Validators securing the sXLM protocol</p>
      </div>

      <div className="grid grid-cols-3 gap-px bg-border rounded-lg overflow-hidden">
        <div className="bg-surface p-5">
          <p className="stat-label">Total</p>
          <p className="stat-value mt-1">{validators.length}</p>
        </div>
        <div className="bg-surface p-5">
          <p className="stat-label">Active</p>
          <p className="stat-value mt-1">{validators.filter(v => v.isActive).length}</p>
        </div>
        <div className="bg-surface p-5">
          <p className="stat-label">Avg Score</p>
          <p className="stat-value mt-1">{avgScore.toFixed(1)}</p>
        </div>
      </div>

      <ValidatorTable />
    </div>
  );
}
