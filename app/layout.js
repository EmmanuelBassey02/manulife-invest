import LegacyClient from './legacy-client';

export const metadata = {
  title: 'SapronLife Financial Investment · Real estate investment platform',
  description: 'Invest in carefully structured real estate opportunities and track your portfolio from one secure platform.',
  icons: { icon: [{ url: '/favicon.png', type: 'image/png' }], apple: '/apple-touch-icon.png' },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#123825',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-upload-mode={process.env.VERCEL === '1' ? 'blob' : 'inline'}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Playfair+Display:wght@500;600;700&display=swap" />
        <link rel="stylesheet" href="/assets/css/app.css" />
      </head>
      <body>
        {children}
        <LegacyClient />
      </body>
    </html>
  );
}