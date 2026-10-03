import React from 'react';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen w-full flex items-center justify-center p-4 md:p-8 bg-background"
      style={{
        backgroundImage:
          'linear-gradient(rgba(29, 78, 216, 0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(29, 78, 216, 0.1) 1px, transparent 1px)',
        backgroundSize: '40px 40px',
      }}
    >
      <div className="w-full max-w-md border border-black bg-background shadow-sw-lg">
        {children}
      </div>
    </div>
  );
}
