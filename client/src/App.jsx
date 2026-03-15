import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { FiHome, FiSettings, FiActivity } from 'react-icons/fi';
import Dashboard from './components/Dashboard';
import Settings from './components/Settings';

const Navigation = () => {
  const location = useLocation();
  const [isMobile, setIsMobile] = React.useState(window.innerWidth <= 640);

  React.useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 640);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  
  return (
    <>
      <nav className="nav-header animate-fade-in">
        <div className="nav-brand">
          <FiActivity className="text-gradient" />
          <span>ExpenseSync</span>
        </div>
        {!isMobile && (
          <div className="nav-links">
            <Link to="/" className={`nav-link ${location.pathname === '/' ? 'active' : ''}`}>
              <FiHome /> Dashboard
            </Link>
            <Link to="/settings" className={`nav-link ${location.pathname === '/settings' ? 'active' : ''}`}>
              <FiSettings /> Connect API
            </Link>
          </div>
        )}
      </nav>

      {isMobile && (
        <nav className="mobile-nav-bar animate-fade-in">
          <Link to="/" className={`mobile-nav-item ${location.pathname === '/' ? 'active' : ''}`}>
            <FiHome />
            <span>Dashboard</span>
          </Link>
          <Link to="/settings" className={`mobile-nav-item ${location.pathname === '/settings' ? 'active' : ''}`}>
            <FiSettings />
            <span>Settings</span>
          </Link>
        </nav>
      )}
    </>
  );
};

function App() {
  return (
    <Router>
      <div className="app-container">
        <Navigation />
        <main>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
