import { useState } from 'react';
import { ChevronUp, ChevronDown, Search } from 'lucide-react';
import { useProtocol } from '../hooks/useProtocol';
import { formatAddress, formatXLM } from '../utils/stellar';

type SortKey = 'performanceScore' | 'uptimePercent' | 'commissionPercent' | 'allocatedStake';

export default function ValidatorTable() {
  const { validators, isLoading } = useProtocol();
  const [sortKey, setSortKey] = useState<SortKey>('performanceScore');
  const [sortAsc, setSortAsc] = useState(false);
  const [search, setSearch] = useState('');

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  const filtered = validators
    .filter((v) =>
      v.pubkey.toLowerCase().includes(search.toLowerCase()) ||
      v.name.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
      const diff = (a[sortKey] as number) - (b[sortKey] as number);
      return sortAsc ? diff : -diff;
    });

  const SortIcon = ({ field }: { field: SortKey }) => {
    if (sortKey !== field) return <ChevronDown className="w-3 h-3 opacity-20" />;
    return sortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
  };

  if (isLoading) {
    return (
      <div className="card p-6 animate-pulse">
        {[...Array(5)].map((_, i) => <div key={i} className="h-10 bg-white/5 rounded mb-2" />)}
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="p-4 border-b border-border">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-600" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search validators..."
            className="w-full pl-10 pr-4 py-2 bg-black border border-border rounded-lg text-sm text-white placeholder-neutral-600 outline-none focus:border-neutral-500"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-left text-[11px] text-neutral-500 uppercase tracking-wider">
              <th className="px-4 py-3 font-medium">Validator</th>
              <th className="px-4 py-3 font-medium cursor-pointer" onClick={() => handleSort('uptimePercent')}>
                <span className="flex items-center gap-1">Uptime <SortIcon field="uptimePercent" /></span>
              </th>
              <th className="px-4 py-3 font-medium cursor-pointer" onClick={() => handleSort('commissionPercent')}>
                <span className="flex items-center gap-1">Commission <SortIcon field="commissionPercent" /></span>
              </th>
              <th className="px-4 py-3 font-medium cursor-pointer" onClick={() => handleSort('performanceScore')}>
                <span className="flex items-center gap-1">Score <SortIcon field="performanceScore" /></span>
              </th>
              <th className="px-4 py-3 font-medium cursor-pointer" onClick={() => handleSort('allocatedStake')}>
                <span className="flex items-center gap-1">Stake <SortIcon field="allocatedStake" /></span>
              </th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((v) => (
              <tr key={v.id} className="border-t border-border hover:bg-white/[0.02] transition-colors">
                <td className="px-4 py-3">
                  <p className="text-sm">{v.name}</p>
                  <p className="text-[10px] text-neutral-600 font-mono">{formatAddress(v.pubkey)}</p>
                </td>
                <td className="px-4 py-3 text-sm">{v.uptimePercent.toFixed(2)}%</td>
                <td className="px-4 py-3 text-sm text-neutral-400">{v.commissionPercent}%</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-12 h-1 bg-white/10 rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-white" style={{ width: `${v.performanceScore}%` }} />
                    </div>
                    <span className="text-sm">{v.performanceScore.toFixed(1)}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-neutral-400">{formatXLM(v.allocatedStake)} XLM</td>
                <td className="px-4 py-3">
                  <span className={`text-[10px] font-medium ${v.isActive ? 'text-green-500' : 'text-red-500'}`}>
                    {v.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
