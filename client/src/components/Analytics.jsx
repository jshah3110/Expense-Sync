import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  PieChart, Pie, Cell, Tooltip as RechartsTooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend
} from 'recharts';
import { FiTrendingUp, FiTrendingDown, FiActivity, FiDollarSign } from 'react-icons/fi';
import API_BASE from '../config';

const COLORS = ['#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#ec4899', '#6366f1', '#eab308'];

const Analytics = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

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

  const { summary, by_category, by_month, top_merchants } = data;

  const deltaFromLastMonth = summary.total_this_month - summary.total_last_month;
  const isUp = deltaFromLastMonth > 0;
  
  // Format currency
  const fmt = (val) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);

  // Function to render custom pie chart labels
  const renderCustomizedLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent, index, name }) => {
    const radius = innerRadius + (outerRadius - innerRadius) + 20; // push label outside
    const x = cx + radius * Math.cos(-midAngle * Math.PI / 180);
    const y = cy + radius * Math.sin(-midAngle * Math.PI / 180);
    
    // Don't show labels for tiny slivers (< 3%)
    if (percent < 0.03) return null;

    return (
      <text 
        x={x} 
        y={y} 
        fill={COLORS[index % COLORS.length]} 
        textAnchor={x > cx ? 'start' : 'end'} 
        dominantBaseline="central"
        fontSize={11}
        fontWeight={500}
      >
        {`${name} (${(percent * 100).toFixed(0)}%)`}
      </text>
    );
  };

  return (
    <div className="animate-fade-in stagger-1" style={{ paddingBottom: '5rem', paddingLeft: '1.25rem', paddingRight: '1.25rem', paddingTop: '1rem' }}>
      <h2 style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>Analytics</h2>
      <p className="subtitle" style={{ fontSize: '0.9rem', marginBottom: '1.5rem', color: 'var(--text-secondary)' }}>Your spending insights.</p>

      {/* KPI Grid */}
      <div className="kpi-grid" style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', 
        gap: '0.75rem', 
        marginBottom: '2rem' 
      }}>
        {/* Total This Month */}
        <div className="glass-card" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase' }}>
            <FiActivity /> This Month
          </div>
          <div style={{ fontSize: '1.35rem', fontWeight: '700' }}>
            {fmt(summary.total_this_month)}
          </div>
          <div style={{ fontSize: '0.75rem', color: isUp ? '#ef4444' : '#10b981', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
            {isUp ? <FiTrendingUp /> : <FiTrendingDown />}
            {fmt(Math.abs(deltaFromLastMonth))} vs prev
          </div>
        </div>

        {/* Daily Average */}
        <div className="glass-card" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase' }}>
            <FiDollarSign /> Daily Avg
          </div>
          <div style={{ fontSize: '1.35rem', fontWeight: '700' }}>
            {fmt(summary.avg_per_day_this_month)}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            Proj: {fmt(summary.avg_per_day_this_month * 30)}
          </div>
        </div>

        {/* Splitwise Impact */}
        <div className="glass-card" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--splitwise)', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase' }}>
            ⚡ Splitwise
          </div>
          <div style={{ fontSize: '1.35rem', fontWeight: '700' }}>
            {fmt(summary.synced_total)}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            {summary.synced_count} expenses pushed
          </div>
        </div>
      </div>

      {/* Charts Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        
        {/* Category Donut */}
        <div className="glass-card" style={{ padding: '1.25rem', height: '350px', display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem' }}>Spending by Category</h3>
          <div style={{ flex: 1, position: 'relative' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={by_category}
                  dataKey="total"
                  nameKey="category"
                  cx="50%"
                  cy="50%"
                  innerRadius="50%"
                  outerRadius="70%"
                  paddingAngle={2}
                  label={renderCustomizedLabel}
                  labelLine={false}
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
            {/* Center Label */}
            <div style={{ 
              position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', 
              textAlign: 'center', pointerEvents: 'none' 
            }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>All Time</div>
              <div style={{ fontSize: '1.1rem', fontWeight: '600' }}>{fmt(summary.total_all_time)}</div>
            </div>
          </div>
        </div>

        {/* Monthly Trend */}
        <div className="glass-card" style={{ padding: '1.25rem', height: '350px', display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem' }}>6 Month Trend</h3>
          <div style={{ flex: 1 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={by_month} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                <XAxis 
                  dataKey="month" 
                  tickFormatter={(val) => {
                    const [y, m] = val.split('-');
                    return new Date(y, m - 1).toLocaleString('default', { month: 'short' });
                  }} 
                  stroke="#666" 
                  fontSize={12} 
                />
                <YAxis 
                  stroke="#666" 
                  fontSize={12} 
                  tickFormatter={(val) => `$${val}`}
                />
                <RechartsTooltip 
                  formatter={(value) => fmt(value)}
                  contentStyle={{ backgroundColor: '#111', border: '1px solid #333', borderRadius: '8px' }} 
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '12px' }}/>
                <Bar dataKey="personal" name="Personal" stackId="a" fill="var(--primary)" radius={[0, 0, 4, 4]} />
                <Bar dataKey="synced" name="Pushed" stackId="a" fill="var(--splitwise)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>

      {/* Top Merchants List */}
      <div className="glass-card" style={{ padding: '1.25rem' }}>
        <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem' }}>Top Merchants</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
          {top_merchants.map((merchant, i) => {
            const maxTotal = top_merchants[0]?.total || 1;
            const pct = (merchant.total / maxTotal) * 100;
            return (
              <div key={merchant.name} style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                  <span>{i+1}. {merchant.name}</span>
                  <span style={{ fontWeight: '500' }}>{fmt(merchant.total)}</span>
                </div>
                {/* Progress bar */}
                <div style={{ height: '6px', background: 'hsla(0,0%,100%,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: 'var(--primary)', borderRadius: '3px' }} />
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
