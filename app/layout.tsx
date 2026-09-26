import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'IconForge — Font Awesome to STL',
  description: 'Turn Font Awesome icons into printable 3D STL files.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
