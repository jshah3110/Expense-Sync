import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { FiHome, FiSettings, FiActivity } from 'react-icons/fi';
import Dashboard from './components/Dashboard';
import Settings from './components/Settings';

const Navigation = () => {
  const location = useLocation();
  
  return (
    <nav className="nav-header animate-fade-in">
      <div className="nav-brand">
        <FiActivity className="text-gradient" />
        <span>ExpenseSync</span>
      </div>
      <div className="nav-links">
        <Link to="/" className={`nav-link ${location.pathname === '/' ? 'active' : ''}`}>
          <FiHome /> Dashboard
        </Link>
        <Link to="/settings" className={`nav-link ${location.pathname === '/settings' ? 'active' : ''}`}>
          <FiSettings /> Connect API
        </Link>
      </div>
    </nav>
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
