import { useState } from 'react';
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';
import { useProtocol } from '../hooks/useProtocol';

type TimeRange = '7d' | '30d' | '90d';

const STROKE = '#000';


/**
 * Charts render nothing when a series is empty, which reads as broken rather
 * than as "no data yet". Say which it is.
 */
function ChartFrame({
  data,
  isLoading,
  children,
}: {
  data: unknown[];
  isLoading: boolean;
  children: React.ReactElement;
}) {
  if (isLoading) {
    return (
      <div className="h-[220px] flex items-center justify-center text-xs text-gray-400">
        Loading…
      </div>
    );
  }
  if (!data.length) {
    return (
      <div className="h-[220px] flex flex-col items-center justify-center gap-1 text-center px-4">
        <p className="text-xs text-gray-500">No history recorded yet</p>
        <p className="text-[10px] text-gray-400 max-w-[24ch]">
          Charts are built from on-chain snapshots. Nothing is shown until there is
          real movement to plot.
        </p>
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      {children}
    </ResponsiveContainer>
  );
}

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

  const tooltipStyle = {
    background: '#fff',
    border: '1px solid #e5e5e5',
    borderRadius: '12px',
    color: '#000',
    fontSize: 12,
    boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
  };

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-6">
        <div className="h-6 w-32 rounded-full animate-pulse bg-[#e5e5e5]" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="card h-72 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-widest mb-2 text-gray-400">On-chain · Real-time</p>
          <h1 className="text-2xl font-semibold text-black mb-1" style={{ letterSpacing: '-0.02em' }}>Analytics</h1>
          <p className="text-sm text-gray-500">Protocol performance over time</p>
        </div>
        <div className="flex gap-0.5 rounded-full p-1 border border-[#e5e5e5] bg-white">
          {(['7d', '30d', '90d'] as TimeRange[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all duration-150 ${
                range === r ? 'bg-black text-white' : 'text-gray-500 hover:text-black'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="card p-5">
          <h3 className="text-xs font-medium mb-1 text-black">APY Over Time</h3>
          <p className="text-[10px] mb-4 text-gray-400">Annual percentage yield</p>
          <ChartFrame data={filterByRange(apyHistory)} isLoading={isLoading}>
            <LineChart data={filterByRange(apyHistory)}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#999' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#999' }} tickFormatter={(v) => `${v.toFixed(1)}%`} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#666' }} formatter={(value: number) => [`${value.toFixed(2)}%`, 'APY']} />
              <Line type="monotone" dataKey="value" stroke={STROKE} strokeWidth={2} dot={false} />
            </LineChart>
          </ChartFrame>
        </div>

        <div className="card p-5">
          <h3 className="text-xs font-medium mb-1 text-black">Exchange Rate</h3>
          <p className="text-[10px] mb-4 text-gray-400">1 sXLM in XLM</p>
          <ChartFrame data={filterByRange(exchangeRateHistory)} isLoading={isLoading}>
            <LineChart data={filterByRange(exchangeRateHistory)}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#999' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#999' }} domain={['auto', 'auto']} tickFormatter={(v) => v.toFixed(4)} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#666' }} formatter={(value: number) => [value.toFixed(6), 'Rate']} />
              <Line type="monotone" dataKey="value" stroke={STROKE} strokeWidth={2} dot={false} />
            </LineChart>
          </ChartFrame>
        </div>

        <div className="card p-5">
          <h3 className="text-xs font-medium mb-1 text-black">Total Value Locked</h3>
          <p className="text-[10px] mb-4 text-gray-400">USD equivalent</p>
          <ChartFrame data={filterByRange(tvlHistory)} isLoading={isLoading}>
            <AreaChart data={filterByRange(tvlHistory)}>
              <defs>
                <linearGradient id="tvlGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#000" stopOpacity={0.08} />
                  <stop offset="100%" stopColor="#000" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#999' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#999' }} tickFormatter={(v) => `$${(v / 1e6).toFixed(1)}M`} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#666' }} formatter={(value: number) => [`$${value.toLocaleString()}`, 'TVL']} />
              <Area type="monotone" dataKey="value" stroke={STROKE} fill="url(#tvlGrad)" strokeWidth={2} />
            </AreaChart>
          </ChartFrame>
        </div>

        <div className="card p-5">
          <h3 className="text-xs font-medium mb-1 text-black">Total XLM Staked</h3>
          <p className="text-[10px] mb-4 text-gray-400">Protocol deposits</p>
          <ChartFrame data={filterByRange(totalStakedHistory)} isLoading={isLoading}>
            <AreaChart data={filterByRange(totalStakedHistory)}>
              <defs>
                <linearGradient id="stakedGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#000" stopOpacity={0.08} />
                  <stop offset="100%" stopColor="#000" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#999' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#999' }} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#666' }} formatter={(value: number) => [`${value.toLocaleString()} XLM`, 'Staked']} />
              <Area type="monotone" dataKey="value" stroke={STROKE} fill="url(#stakedGrad)" strokeWidth={2} />
            </AreaChart>
          </ChartFrame>
        </div>
      </div>
    </div>
  );
}
