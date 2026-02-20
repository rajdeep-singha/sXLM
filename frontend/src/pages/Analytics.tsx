import { useState } from 'react';
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';
import { useProtocol } from '../hooks/useProtocol';

type TimeRange = '7d' | '30d' | '90d';

export default function Analytics() {
  const { apyHistory, exchangeRateHistory, tvlHistory, totalStakedHistory, isLoading } = useProtocol();
  const [range, setRange] = useState<TimeRange>('30d');

  const filterByRange = (data: Array<{ timestamp: string; value: number }>) => {
    const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return data
      .filter((d) => new Date(d.timestamp).getTime() >= cutoff)
      .map((d) => ({
        date: new Date(d.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        value: d.value,
      }));
  };

  const tooltipStyle = { background: '#111', border: '1px solid #222', borderRadius: '6px' };

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <div className="h-6 w-32 bg-white/5 rounded animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[...Array(4)].map((_, i) => <div key={i} className="card h-72 animate-pulse" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold mb-1">Analytics</h1>
          <p className="text-neutral-500 text-sm">Protocol performance over time</p>
        </div>
        <div className="flex gap-0.5 bg-surface border border-border rounded-lg p-0.5">
          {(['7d', '30d', '90d'] as TimeRange[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                range === r ? 'bg-white text-black' : 'text-neutral-500 hover:text-white'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-5">
          <h3 className="text-xs font-medium text-neutral-400 mb-4">APY Over Time</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={filterByRange(apyHistory)}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#666' }} />
              <YAxis tick={{ fontSize: 10, fill: '#666' }} tickFormatter={(v) => `${v.toFixed(1)}%`} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#666' }} formatter={(value: number) => [`${value.toFixed(2)}%`, 'APY']} />
              <Line type="monotone" dataKey="value" stroke="#fff" strokeWidth={1.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-5">
          <h3 className="text-xs font-medium text-neutral-400 mb-4">Exchange Rate</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={filterByRange(exchangeRateHistory)}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#666' }} />
              <YAxis tick={{ fontSize: 10, fill: '#666' }} domain={['auto', 'auto']} tickFormatter={(v) => v.toFixed(4)} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#666' }} formatter={(value: number) => [value.toFixed(6), 'Rate']} />
              <Line type="monotone" dataKey="value" stroke="#fff" strokeWidth={1.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-5">
          <h3 className="text-xs font-medium text-neutral-400 mb-4">Total Value Locked (USD)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={filterByRange(tvlHistory)}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#666' }} />
              <YAxis tick={{ fontSize: 10, fill: '#666' }} tickFormatter={(v) => `$${(v / 1e6).toFixed(1)}M`} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#666' }} formatter={(value: number) => [`$${value.toLocaleString()}`, 'TVL']} />
              <Area type="monotone" dataKey="value" stroke="#fff" fill="#ffffff08" strokeWidth={1.5} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-5">
          <h3 className="text-xs font-medium text-neutral-400 mb-4">Total XLM Staked</h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={filterByRange(totalStakedHistory)}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#666' }} />
              <YAxis tick={{ fontSize: 10, fill: '#666' }} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#666' }} formatter={(value: number) => [`${value.toLocaleString()} XLM`, 'Staked']} />
              <Area type="monotone" dataKey="value" stroke="#fff" fill="#ffffff08" strokeWidth={1.5} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
