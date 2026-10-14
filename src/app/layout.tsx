import type { Metadata } from 'next';
import './globals.css';
import { Pwa } from '@/components/pwa';
export const metadata: Metadata = {
  title: 'CCIDA Event POS',
  description: 'ระบบบริหารการจำหน่ายสินค้าและชำระเงินภายในกิจกรรม',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body>
        <Pwa />
        {children}
      </body>
    </html>
  );
}
