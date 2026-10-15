import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import { locationService } from '../../services/location/locationService';
import { useOverlayDialogA11y } from '../../hooks/useOverlayDialogA11y';
import { useScrollRegionA11y } from '../../hooks/useScrollRegionA11y';

interface AppLayoutProps {
  role?: 'admin' | 'employee';
}

const AppLayout: React.FC<AppLayoutProps> = ({ role = 'admin' }) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  useOverlayDialogA11y();
  useScrollRegionA11y();

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

  // Mobile drawer: Escape closes it, the page behind it does not scroll, and focus returns to the
  // menu button when it closes.
  React.useEffect(() => {
    if (!isMobileMenuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsMobileMenuOpen(false); };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('nav-open');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('nav-open');
      (document.querySelector('.menu-toggle') as HTMLElement | null)?.focus();
    };
  }, [isMobileMenuOpen]);

  return (
    <>
      <div className="bg-blobs"></div>
      <div className="app-layout">
      <Sidebar isOpen={isMobileMenuOpen} onClose={closeMobileMenu} role={role} />
      
      <div className="main-wrapper">
        <Header toggleMenu={toggleMobileMenu} role={role} menuOpen={isMobileMenuOpen} />
        <main className="main-content">
          <Outlet />
        </main>
      </div>
      </div>
    </>
  );
};

export default AppLayout;
