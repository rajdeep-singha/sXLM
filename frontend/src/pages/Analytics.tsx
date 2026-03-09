import { useState } from 'react';
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';
import { useProtocol } from '../hooks/useProtocol';

type TimeRange = '7d' | '30d' | '90d';

const Y = '#F5CF00';

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
    background: '#0d0d0d',
    border: '1px solid #1e1e1e',
    borderRadius: '8px',
    color: '#fff',
    fontSize: 12,
  };

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-6">
        <div className="h-6 w-32 rounded animate-pulse" style={{ background: 'rgba(255,255,255,0.05)' }} />
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
          <p className="text-[11px] uppercase tracking-widest mb-2" style={{ color: Y }}>
            On-chain · Real-time
          </p>
          <h1 className="text-2xl font-bold text-white mb-1">Analytics</h1>
          <p className="text-sm" style={{ color: '#525252' }}>Protocol performance over time</p>
        </div>
        <div
          className="flex gap-0.5 rounded-lg p-0.5"
          style={{ background: '#0d0d0d', border: '1px solid #1e1e1e' }}
        >
          {(['7d', '30d', '90d'] as TimeRange[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className="px-3 py-1 rounded text-xs font-medium transition-all duration-150"
              style={{
                background: range === r ? Y : 'transparent',
                color: range === r ? '#000' : '#525252',
                fontWeight: range === r ? 600 : 400,
              }}
              onMouseEnter={(e) => {
                if (range !== r) e.currentTarget.style.color = '#fff';
              }}
              onMouseLeave={(e) => {
                if (range !== r) e.currentTarget.style.color = '#525252';
              }}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="card p-5">
          <h3 className="text-xs font-medium mb-1" style={{ color: Y }}>APY Over Time</h3>
          <p className="text-[10px] mb-4" style={{ color: '#383838' }}>Annual percentage yield</p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={filterByRange(apyHistory)}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#444' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#444' }} tickFormatter={(v) => `${v.toFixed(1)}%`} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#666' }} formatter={(value: number) => [`${value.toFixed(2)}%`, 'APY']} />
              <Line type="monotone" dataKey="value" stroke={Y} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-5">
          <h3 className="text-xs font-medium mb-1" style={{ color: Y }}>Exchange Rate</h3>
          <p className="text-[10px] mb-4" style={{ color: '#383838' }}>1 sXLM in XLM</p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={filterByRange(exchangeRateHistory)}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#444' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#444' }} domain={['auto', 'auto']} tickFormatter={(v) => v.toFixed(4)} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#666' }} formatter={(value: number) => [value.toFixed(6), 'Rate']} />
              <Line type="monotone" dataKey="value" stroke={Y} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-5">
          <h3 className="text-xs font-medium mb-1" style={{ color: Y }}>Total Value Locked</h3>
          <p className="text-[10px] mb-4" style={{ color: '#383838' }}>USD equivalent</p>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={filterByRange(tvlHistory)}>
              <defs>
                <linearGradient id="tvlGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={Y} stopOpacity={0.15} />
                  <stop offset="100%" stopColor={Y} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#444' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#444' }} tickFormatter={(v) => `$${(v / 1e6).toFixed(1)}M`} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#666' }} formatter={(value: number) => [`$${value.toLocaleString()}`, 'TVL']} />
              <Area type="monotone" dataKey="value" stroke={Y} fill="url(#tvlGrad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-5">
          <h3 className="text-xs font-medium mb-1" style={{ color: Y }}>Total XLM Staked</h3>
          <p className="text-[10px] mb-4" style={{ color: '#383838' }}>Protocol deposits</p>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={filterByRange(totalStakedHistory)}>
              <defs>
                <linearGradient id="stakedGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={Y} stopOpacity={0.15} />
                  <stop offset="100%" stopColor={Y} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#444' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#444' }} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#666' }} formatter={(value: number) => [`${value.toLocaleString()} XLM`, 'Staked']} />
              <Area type="monotone" dataKey="value" stroke={Y} fill="url(#stakedGrad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
