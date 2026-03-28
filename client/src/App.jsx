import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { FiHome, FiSettings, FiActivity, FiBarChart2 } from 'react-icons/fi';
import Dashboard from './components/Dashboard';
import Settings from './components/Settings';
import Analytics from './components/Analytics';

const Navigation = ({ isMobile }) => {
  const location = useLocation();

  return (
    <>
      {!isMobile && (
        <nav className="nav-header animate-fade-in">
          <div className="nav-brand">
            <FiActivity className="text-gradient" />
            <span>ExpenseSync</span>
          </div>
          <div className="nav-links">
            <Link to="/" className={`nav-link ${location.pathname === '/' ? 'active' : ''}`}>
              <FiHome /> Home
            </Link>
            <Link to="/analytics" className={`nav-link ${location.pathname === '/analytics' ? 'active' : ''}`}>
              <FiBarChart2 /> Analytics
            </Link>
          </div>
          <Link to="/settings" className={`nav-link ${location.pathname === '/settings' ? 'active' : ''}`} style={{ padding: '0.5rem 1rem', width: 'auto', background: 'transparent', border: 'none' }} title="Settings">
            <FiSettings style={{ fontSize: '1.2rem', color: 'var(--text-secondary)' }} />
          </Link>
        </nav>
      )}

      {isMobile && (
        <nav className="mobile-nav-bar animate-fade-in" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <Link to="/" className={`mobile-nav-item ${location.pathname === '/' ? 'active' : ''}`}>
            <FiHome />
            <span>Home</span>
          </Link>
          <Link to="/analytics" className={`mobile-nav-item ${location.pathname === '/analytics' ? 'active' : ''}`}>
            <FiBarChart2 />
            <span>Analytics</span>
          </Link>
        </nav>
      )}
    </>
  );
};

function App() {
  const [isMobile, setIsMobile] = React.useState(window.innerWidth <= 640);

  React.useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 640);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Lifted Analytics state so it persists across navigation
  const [analyticsViewMode, setAnalyticsViewMode] = React.useState('bar');
  const [analyticsSpendView, setAnalyticsSpendView] = React.useState('splitwise');
  const [analyticsSelectedMonth, setAnalyticsSelectedMonth] = React.useState(null);

  return (
    <Router>
      <div style={{ minHeight: '100vh', minHeight: '-webkit-fill-available' }}>
        <Navigation isMobile={isMobile} />
        <main className="app-container">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/analytics" element={
              <Analytics
                viewMode={analyticsViewMode}
                setViewMode={setAnalyticsViewMode}
                spendView={analyticsSpendView}
                setSpendView={setAnalyticsSpendView}
                selectedMonth={analyticsSelectedMonth}
                setSelectedMonth={setAnalyticsSelectedMonth}
              />
            } />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
