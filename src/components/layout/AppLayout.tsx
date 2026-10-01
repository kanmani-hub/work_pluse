import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import { locationService } from '../../services/location/locationService';

interface AppLayoutProps {
  role?: 'admin' | 'employee';
}

const AppLayout: React.FC<AppLayoutProps> = ({ role = 'admin' }) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  React.useEffect(() => {
    if (role === 'employee') {
      locationService.startLiveTracking();
    }
    return () => {
      if (role === 'employee') {
        locationService.stopLiveTracking();
      }
    };
  }, [role]);

  const closeMobileMenu = () => {
    setIsMobileMenuOpen(false);
  };

  return (
    <div className="app-layout">
      <Sidebar isOpen={isMobileMenuOpen} onClose={closeMobileMenu} role={role} />
      
      <div className="main-wrapper">
        <Header toggleMenu={toggleMobileMenu} role={role} />
        <main className="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default AppLayout;
