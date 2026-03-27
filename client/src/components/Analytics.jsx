import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  PieChart, Pie, Cell, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  AreaChart, Area
} from 'recharts';
import { FiBarChart2, FiActivity, FiChevronRight } from 'react-icons/fi';
import API_BASE from '../config';

const COLORS = ['#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#ec4899', '#6366f1', '#eab308'];

const Analytics = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('bar'); // 'bar' or 'line'

  useEffect(() => {
    const fetchAnalytics = async () => {
      try {
        const res = await axios.get(`${API_BASE}/api/transactions/analytics`);
        setData(res.data);
      } catch (e) {
        console.error("Failed to fetch analytics", e);
      } finally {
        setLoading(false);
      }
    };
    fetchAnalytics();
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
        <div style={{ color: 'var(--text-secondary)' }}>Loading analytics...</div>
      </div>
    );
  }

  if (!data || !data.summary) {
    return (
      <div style={{ textAlign: 'center', marginTop: '2rem', color: 'var(--text-secondary)' }}>
        No analytic data available.
      </div>
    );
  }

  const { summary, by_category, by_month, pacing } = data;
  const fmt = (val) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
  
  // Calculate specific metrics for header
  const totalThisMonth = summary.total_this_month;
  const totalLastMonth = summary.total_last_month;
  const delta = totalThisMonth - totalLastMonth;
  const deltaFormatted = fmt(Math.abs(delta));
  const deltaText = delta >= 0 ? `${deltaFormatted} more` : `${deltaFormatted} less`;
  
  // Calculate historical monthly average instead of projected daily
  const historyAverage = by_month.length > 0 
    ? by_month.reduce((acc, m) => acc + m.total, 0) / by_month.length 
    : 0;

  const currentMonthName = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });

  return (
    <div className="animate-fade-in stagger-1" style={{ paddingBottom: '7rem', paddingTop: '1rem', paddingLeft: '1.25rem', paddingRight: '1.25rem' }}>
      
      {/* HEADER SECTION */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.75rem', fontWeight: 600, margin: 0 }}>Expenses</h2>
        
        {/* View Toggle */}
        <div style={{ 
          display: 'flex', 
          background: 'hsla(0,0%,100%,0.05)', 
          borderRadius: '50px', 
          padding: '0.2rem',
          border: '1px solid var(--border-light)'
        }}>
          <button 
            onClick={() => setViewMode('bar')}
            style={{ 
              background: viewMode === 'bar' ? 'hsla(0,0%,100%,0.1)' : 'transparent',
              color: viewMode === 'bar' ? 'var(--text-primary)' : 'var(--text-secondary)',
              border: 'none', borderRadius: '50px', padding: '0.4rem 0.8rem', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s'
            }}
          >
            <FiBarChart2 size={16} />
          </button>
          <button 
            onClick={() => setViewMode('line')}
            style={{ 
              background: viewMode === 'line' ? 'hsla(0,0%,100%,0.1)' : 'transparent',
              color: viewMode === 'line' ? 'var(--text-primary)' : 'var(--text-secondary)',
              border: 'none', borderRadius: '50px', padding: '0.4rem 0.8rem', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s'
            }}
          >
            <FiActivity size={16} />
          </button>
        </div>
      </div>

      {/* METRIC ACCUMULATOR */}
      <div style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <span style={{ fontSize: '2.5rem', fontWeight: 700, letterSpacing: '-0.03em' }}>
            {fmt(totalThisMonth)}
          </span>
          <span style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>
            {currentMonthName}
          </span>
        </div>
        
        <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {viewMode === 'line' ? (
            <div>
              <span style={{ color: delta >= 0 ? '#f59e0b' : '#10b981', fontWeight: 500 }}>{deltaText}</span>
              <span> than last month</span>
            </div>
          ) : (
            <div>
              <span style={{ color: '#f59e0b', fontWeight: 500 }}>{fmt(historyAverage)}</span>
              <span> average monthly expenses</span>
            </div>
          )}
          {summary.synced_total > 0 && (
            <div style={{ marginTop: '0.25rem' }}>
              <span style={{ color: 'var(--splitwise)', fontWeight: 500 }}>{fmt(summary.synced_total)}</span>
              <span> pushed to Splitwise ({summary.synced_percentage}%)</span>
            </div>
          )}
        </div>
      </div>

      {/* MAIN CHART */}
      <div style={{ height: '300px', marginBottom: '2rem', marginLeft: '-1.5rem', marginRight: '-1rem' }}>
        <ResponsiveContainer width="100%" height="100%">
          {viewMode === 'line' ? (
            <AreaChart data={pacing} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="colorThis" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="var(--primary)" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsla(0,0%,100%,0.05)" />
              <XAxis dataKey="day" stroke="#666" fontSize={12} tickLine={false} axisLine={false} tickMargin={10} minTickGap={30} />
              <YAxis hide />
              <RechartsTooltip 
                contentStyle={{ backgroundColor: '#111', border: '1px solid #333', borderRadius: '8px' }}
                labelFormatter={(v) => `Day ${v}`}
                formatter={(val) => [fmt(val), 'Spent']}
              />
              <Area type="stepAfter" dataKey="last_month" stroke="#888" strokeDasharray="4 4" fill="none" strokeWidth={2} isAnimationActive={false} />
              <Area type="stepAfter" dataKey="this_month" stroke="var(--primary)" fillOpacity={1} fill="url(#colorThis)" strokeWidth={3} isAnimationActive={false} />
            </AreaChart>
          ) : (
            <BarChart data={by_month} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsla(0,0%,100%,0.05)" />
              <XAxis 
                dataKey="month" 
                tickFormatter={(val) => {
                  const [y, m] = val.split('-');
                  return new Date(y, m - 1).toLocaleString('default', { month: 'short' });
                }} 
                stroke="#666" 
                fontSize={12} 
                tickLine={false}
                axisLine={false}
                tickMargin={10}
              />
              <YAxis hide />
              <RechartsTooltip 
                cursor={{fill: 'hsla(0,0%,100%,0.02)'}}
                contentStyle={{ backgroundColor: '#111', border: '1px solid #333', borderRadius: '8px' }}
                formatter={(val) => [fmt(val)]}
              />
              <Bar dataKey="total" fill="var(--primary)" radius={[4, 4, 0, 0]} maxBarSize={48} isAnimationActive={false} />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>

      {/* CHART LEGEND (Custom Layout) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', paddingBottom: '2.5rem', borderBottom: '1px solid var(--border-light)', marginBottom: '2.5rem' }}>
        {viewMode === 'line' ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                <div style={{ width: '16px', height: '16px', borderRadius: '50%', background: 'var(--primary)' }} />
                <span style={{ fontWeight: 500 }}>This month</span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 600 }}>{fmt(totalThisMonth)}</div>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                <div style={{ width: '16px', height: '16px', borderRadius: '50%', border: '2px dashed #888' }} />
                <span style={{ fontWeight: 500 }}>Last month</span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 600 }}>{fmt(totalLastMonth)}</div>
              </div>
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
              <div style={{ width: '16px', height: '16px', borderRadius: '50%', background: 'var(--primary)' }} />
              <span style={{ fontWeight: 500 }}>Expenses</span>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 600 }}>{fmt(totalThisMonth)}</div>
            </div>
          </div>
        )}
      </div>

      {/* CATEGORY SPEND COMPONENT */}
      <div className="glass-card" style={{ padding: '1.5rem', borderRadius: '24px' }}>
        <h3 style={{ fontSize: '1.1rem', marginBottom: '1.5rem', fontWeight: 600 }}>Categories</h3>
        
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '2rem' }}>
          <div style={{ height: '220px', width: '100%', position: 'relative' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={by_category}
                  dataKey="total"
                  nameKey="category"
                  cx="50%"
                  cy="50%"
                  innerRadius="65%"
                  outerRadius="100%"
                  paddingAngle={2}
                  stroke="none"
                >
                  {by_category.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <RechartsTooltip 
                  formatter={(value) => fmt(value)}
                  contentStyle={{ backgroundColor: '#111', border: '1px solid #333', borderRadius: '8px' }} 
                />
              </PieChart>
            </ResponsiveContainer>
            {/* Center Label inside Pie */}
            <div style={{ 
              position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', 
              textAlign: 'center', pointerEvents: 'none' 
            }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '1px' }}>Total</div>
              <div style={{ fontSize: '1.2rem', fontWeight: '700' }}>{fmt(summary.total_all_time)}</div>
            </div>
          </div>
        </div>

        {/* Category List Breakdown */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {by_category.map((cat, i) => {
            const pct = summary.total_all_time > 0 ? (cat.total / summary.total_all_time) * 100 : 0;
            return (
              <div key={cat.category} style={{ 
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', 
                padding: '1rem 0',
                borderBottom: i < by_category.length - 1 ? '1px solid hsla(0,0%,100%,0.05)' : 'none'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: COLORS[i % COLORS.length] }} />
                  <span style={{ fontWeight: 500, fontSize: '1rem' }}>{cat.category}</span>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{pct.toFixed(1)}%</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontWeight: 600 }}>{fmt(cat.total)}</span>
                  <FiChevronRight color="var(--text-muted)" />
                </div>
              </div>
            );
          })}
        </div>

      </div>
      
    </div>
  );
};

export default Analytics;
