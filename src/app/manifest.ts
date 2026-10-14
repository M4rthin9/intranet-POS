import type { MetadataRoute } from 'next';
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'CCIDA Event POS & Payment',
    short_name: 'CCIDA POS',
    description: 'ระบบบริหารการจำหน่ายสินค้าและชำระเงินภายในกิจกรรม',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f3f5f8',
    theme_color: '#176357',
    lang: 'th',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
    ],
  };
}
