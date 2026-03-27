import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import {
  PieChart, Pie, Cell, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  AreaChart, Area,
} from 'recharts';
import { FiBarChart2, FiActivity, FiChevronRight, FiX } from 'react-icons/fi';
import API_BASE from '../config';

const COLORS = ['#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#ec4899', '#6366f1', '#eab308'];

const fmt = (val) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val ?? 0);

const monthLabel = (yyyyMm) => {
  if (!yyyyMm) return '';
  const [y, m] = yyyyMm.split('-');
  return new Date(Number(y), Number(m) - 1).toLocaleString('default', { month: 'long', year: 'numeric' });
};

const monthShort = (yyyyMm) => {
  if (!yyyyMm) return '';
  const [y, m] = yyyyMm.split('-');
  return new Date(Number(y), Number(m) - 1).toLocaleString('default', { month: 'short' });
};

// ── Custom Bar shape so each bar is independently coloured ────────────────────
const ColoredBar = (props) => {
  const { x, y, width, height, fill } = props;
  if (height <= 0) return null;
  const rx = 4;
  return (
    <path
      d={`M${x + rx},${y} h${width - rx * 2} a${rx},${rx} 0 0 1 ${rx},${rx} v${height - rx} H${x} V${y + rx} a${rx},${rx} 0 0 1 ${rx},-${rx}z`}
      fill={fill}
      style={{ cursor: 'pointer' }}
    />
  );
};

// ── Custom Pie label renderer ────────────────────────────────────────────────
const renderPieLabel = (entry, total) => {
  const pct = total > 0 ? ((entry.total / total) * 100).toFixed(0) : 0;
  return `${entry.category} ${pct}%`;
};

// ── Custom Pie label component for styling ────────────────────────────────
const PieLabel = (props) => {
  const { cx, cy, midAngle, innerRadius, outerRadius, percent } = props;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * Math.PI / 180);
  const y = cy + radius * Math.sin(-midAngle * Math.PI / 180);

  return (
    <text
      x={x}
      y={y}
      fill="white"
      textAnchor={x > cx ? 'start' : 'end'}
      dominantBaseline="central"
      fontSize="12"
      fontWeight="600"
    >
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
};

const Analytics = () => {
  const [data, setData]               = useState(null);
  const [loading, setLoading]         = useState(true);
  const [viewMode, setViewMode]       = useState('bar');       // 'bar' | 'line'
  const [selectedMonth, setSelectedMonth] = useState(null);   // null = current month

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const fetchAnalytics = useCallback(async (month) => {
    setLoading(true);
    try {
      const url = `${API_BASE}/api/transactions/analytics${month ? `?month=${month}` : ''}`;
      const res = await axios.get(url);
      setData(res.data);
    } catch (e) {
      console.error('Failed to fetch analytics', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAnalytics(selectedMonth);
  }, [selectedMonth, fetchAnalytics]);

  // ── Bar click handler ─────────────────────────────────────────────────────
  const handleBarClick = (barData) => {
    if (!barData?.month) return;
    setSelectedMonth((prev) => (prev === barData.month ? null : barData.month));
  };

  // ── Loading / empty states ────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
        <div style={{ color: 'var(--text-secondary)' }}>Loading analytics…</div>
      </div>
    );
  }

  if (!data?.summary) {
    return (
      <div style={{ textAlign: 'center', marginTop: '2rem', color: 'var(--text-secondary)' }}>
        No analytic data available.
      </div>
    );
  }

  const { summary, by_category, by_month, pacing } = data;

  // Month labels from backend so they're always in sync
  const targetLabel = monthLabel(summary.target_month);
  const prevLabel   = monthLabel(summary.prev_month);

  const delta          = summary.total_this_month - summary.total_last_month;
  const deltaFormatted = fmt(Math.abs(delta));
  const deltaText      = delta >= 0 ? `${deltaFormatted} more` : `${deltaFormatted} less`;

  const historyAverage =
    by_month.length > 0
      ? by_month.reduce((acc, m) => acc + m.total, 0) / by_month.length
      : 0;

  // Pacing has data if at least one non-null, non-zero value exists
  const pacingHasData = pacing.some((p) => (p.this_month ?? 0) > 0 || (p.last_month ?? 0) > 0);

  return (
    <div
      className="animate-fade-in stagger-1"
      style={{ paddingBottom: '7rem', paddingTop: '1rem', paddingLeft: '1.25rem', paddingRight: '1.25rem' }}
    >
      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.75rem', fontWeight: 600, margin: 0 }}>Expenses</h2>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {/* Active month chip */}
          {selectedMonth && (
            <button
              onClick={() => setSelectedMonth(null)}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.35rem',
                background: 'hsla(0,0%,100%,0.08)',
                border: '1px solid var(--border-light)',
                borderRadius: '50px', padding: '0.35rem 0.75rem',
                color: 'var(--text-primary)', fontSize: '0.8rem', cursor: 'pointer',
              }}
            >
              {monthShort(selectedMonth)}
              <FiX size={12} />
            </button>
          )}

          {/* View toggle */}
          <div style={{
            display: 'flex', background: 'hsla(0,0%,100%,0.05)',
            borderRadius: '50px', padding: '0.2rem',
            border: '1px solid var(--border-light)',
          }}>
            {[
              { mode: 'bar',  Icon: FiBarChart2 },
              { mode: 'line', Icon: FiActivity  },
            ].map(({ mode, Icon }) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                style={{
                  background: viewMode === mode ? 'hsla(0,0%,100%,0.1)' : 'transparent',
                  color: viewMode === mode ? 'var(--text-primary)' : 'var(--text-secondary)',
                  border: 'none', borderRadius: '50px', padding: '0.4rem 0.8rem',
                  cursor: 'pointer', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', transition: 'all 0.2s',
                }}
              >
                <Icon size={16} />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── METRIC SUMMARY ─────────────────────────────────────────────────── */}
      <div style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <span style={{ fontSize: '2.5rem', fontWeight: 700, letterSpacing: '-0.03em' }}>
            {fmt(summary.total_this_month)}
          </span>
          <span style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>
            {targetLabel}
          </span>
        </div>

        <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {viewMode === 'line' ? (
            <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              <span style={{ color: delta >= 0 ? '#f59e0b' : '#10b981', fontWeight: 500 }}>{deltaText}</span>
              <span> than {prevLabel}</span>
            </div>
          ) : (
            <div>
              <span style={{ color: '#f59e0b', fontWeight: 500 }}>{fmt(historyAverage)}</span>
              <span> average monthly expenses</span>
            </div>
          )}
          {summary.synced_total > 0 && (
            <div style={{ marginTop: '0.25rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              <span style={{ color: 'var(--splitwise)', fontWeight: 500 }}>{fmt(summary.synced_total)}</span>
              <span> pushed to Splitwise ({summary.synced_percentage}%)</span>
            </div>
          )}
        </div>

        {/* Spend Breakdown Bar */}
        {summary.total_this_month > 0 && (
          <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ display: 'flex', height: '24px', gap: '2px', borderRadius: '4px', overflow: 'hidden', background: 'hsla(0,0%,100%,0.05)' }}>
              <div style={{
                flex: summary.unsynced_percentage,
                background: '#ef4444',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.7rem',
                fontWeight: 600,
                color: 'white',
                minWidth: summary.unsynced_percentage > 15 ? 'auto' : 0,
                overflow: 'hidden'
              }}>
                {summary.unsynced_percentage > 15 && `${summary.unsynced_percentage}%`}
              </div>
              <div style={{
                flex: summary.synced_percentage,
                background: 'var(--splitwise)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.7rem',
                fontWeight: 600,
                color: 'white',
                minWidth: summary.synced_percentage > 15 ? 'auto' : 0,
                overflow: 'hidden'
              }}>
                {summary.synced_percentage > 15 && `${summary.synced_percentage}%`}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '1rem', fontSize: '0.8rem' }}>
              <div><span style={{ color: '#ef4444', fontWeight: 600 }}>Others:</span> {fmt(summary.unsynced_total)}</div>
              <div><span style={{ color: 'var(--splitwise)', fontWeight: 600 }}>Splitwise:</span> {fmt(summary.synced_total)}</div>
            </div>
          </div>
        )}
      </div>

      {/* ── MAIN CHART ─────────────────────────────────────────────────────── */}
      <div style={{ height: '300px', marginBottom: '2rem', marginLeft: '-1.5rem', marginRight: '-1rem' }}>
        <ResponsiveContainer width="100%" height="100%">
          {viewMode === 'line' ? (
            pacingHasData ? (
              <AreaChart data={pacing} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorThis" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="var(--primary)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsla(0,0%,100%,0.05)" />
                <XAxis
                  dataKey="day"
                  stroke="#666" fontSize={12} tickLine={false} axisLine={false}
                  tickMargin={10} minTickGap={30}
                />
                <YAxis hide domain={['auto', 'auto']} />
                <RechartsTooltip
                  contentStyle={{ backgroundColor: '#111', border: '1px solid #333', borderRadius: '8px' }}
                  labelFormatter={(v) => `Day ${v}`}
                  formatter={(val, name) => [
                    fmt(val),
                    name === 'this_month' ? targetLabel : prevLabel,
                  ]}
                />
                <Area
                  type="monotone" dataKey="last_month"
                  stroke="#888" strokeDasharray="4 4" fill="none"
                  strokeWidth={2} isAnimationActive={false} connectNulls
                />
                <Area
                  type="monotone" dataKey="this_month"
                  stroke="var(--primary)" fillOpacity={1} fill="url(#colorThis)"
                  strokeWidth={3} isAnimationActive={false} connectNulls
                />
              </AreaChart>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
                  No spending data for {targetLabel}
                </span>
              </div>
            )
          ) : (
            <BarChart
              data={by_month}
              margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsla(0,0%,100%,0.05)" />
              <XAxis
                dataKey="month"
                tickFormatter={monthShort}
                stroke="#666" fontSize={12} tickLine={false} axisLine={false} tickMargin={10}
              />
              <YAxis hide />
              <RechartsTooltip
                cursor={{ fill: 'hsla(0,0%,100%,0.02)' }}
                contentStyle={{ backgroundColor: '#111', border: '1px solid #333', borderRadius: '8px' }}
                labelFormatter={monthLabel}
                formatter={(val) => [fmt(val), 'Total']}
              />
              <Bar
                dataKey="total"
                maxBarSize={48}
                isAnimationActive={false}
                shape={<ColoredBar />}
                onClick={(barData) => handleBarClick(barData)}
              >
                {by_month.map((entry) => (
                  <Cell
                    key={entry.month}
                    fill={
                      !selectedMonth || entry.month === selectedMonth
                        ? 'var(--primary)'
                        : 'rgba(139,92,246,0.3)'
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>

      {/* ── CHART LEGEND ───────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: '1rem',
        paddingBottom: '2.5rem', borderBottom: '1px solid var(--border-light)', marginBottom: '2.5rem',
      }}>
        {viewMode === 'line' ? (
          <>
            <LegendRow
              dot={{ background: 'var(--primary)' }}
              label={targetLabel}
              value={fmt(summary.total_this_month)}
            />
            <LegendRow
              dot={{ border: '2px dashed #888' }}
              label={prevLabel}
              value={fmt(summary.total_last_month)}
            />
          </>
        ) : (
          <LegendRow
            dot={{ background: 'var(--primary)' }}
            label={selectedMonth ? `${targetLabel} total` : 'Expenses'}
            value={fmt(summary.total_this_month)}
          />
        )}
      </div>

      {/* ── CATEGORY BREAKDOWN ─────────────────────────────────────────────── */}
      <div className="glass-card" style={{ padding: '1.5rem', borderRadius: '24px' }}>
        <h3 style={{ fontSize: '1.1rem', marginBottom: '1.5rem', fontWeight: 600 }}>
          Categories
          {selectedMonth && (
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 400, marginLeft: '0.5rem' }}>
              · {targetLabel}
            </span>
          )}
        </h3>

        {by_category.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '2rem 0' }}>
            No transactions for {targetLabel}
          </div>
        ) : (
          <>
            {/* Donut */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '2rem' }}>
              <div style={{ height: '280px', width: '100%', position: 'relative', paddingTop: '1rem' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={by_category} dataKey="total" nameKey="category"
                      cx="50%" cy="50%" innerRadius="65%" outerRadius="100%"
                      paddingAngle={2} stroke="none"
                      label={<PieLabel />}
                      labelLine={false}
                    >
                      {by_category.map((entry, i) => (
                        <Cell key={`cell-${summary.target_month}-${i}`} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <RechartsTooltip
                      formatter={(value) => fmt(value)}
                      contentStyle={{ backgroundColor: '#111', border: '1px solid #333', borderRadius: '8px' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                {/* Center label */}
                <div style={{
                  position: 'absolute', top: '50%', left: '50%',
                  transform: 'translate(-50%, -50%)',
                  textAlign: 'center', pointerEvents: 'none',
                }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '1px' }}>
                    {monthShort(summary.target_month)}
                  </div>
                  <div style={{ fontSize: '1.2rem', fontWeight: '700' }}>
                    {fmt(summary.total_this_month)}
                  </div>
                </div>
              </div>
            </div>

            {/* Category list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {by_category.map((cat, i) => {
                const pct = summary.total_this_month > 0
                  ? (cat.total / summary.total_this_month) * 100
                  : 0;
                return (
                  <div
                    key={`${summary.target_month}-${cat.category}`}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '0.875rem 1rem',
                      borderRadius: '12px',
                      background: 'hsla(0,0%,100%,0)',
                      transition: 'all 0.2s ease',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'hsla(0,0%,100%,0.04)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'hsla(0,0%,100%,0)';
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1 }}>
                      <div style={{ width: '14px', height: '14px', borderRadius: '50%', background: COLORS[i % COLORS.length], flexShrink: 0 }} />
                      <span style={{ fontWeight: 500, fontSize: '1rem' }}>{cat.category}</span>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{pct.toFixed(0)}%</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontWeight: 600, fontSize: '1rem' }}>{fmt(cat.total)}</span>
                      <FiChevronRight size={18} style={{ color: 'var(--text-muted)', transition: 'all 0.2s ease', opacity: 0.6 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// ── Small legend row helper ────────────────────────────────────────────────────
const LegendRow = ({ dot, label, value }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
      <div style={{ width: '12px', height: '12px', borderRadius: '50%', flexShrink: 0, ...dot }} />
      <span style={{ fontWeight: 500 }}>{label}</span>
    </div>
    <span style={{ fontWeight: 600 }}>{value}</span>
  </div>
);

export default Analytics;
