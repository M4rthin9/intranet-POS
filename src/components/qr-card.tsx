'use client';
import Image from 'next/image';
import { money } from './context';

type Props = {
  number: string;
  customerName: string;
  qrImage: string;
  registrationNumber?: string;
  recipientName?: string | null;
  imageAlt?: string;
} & (
  | {
      kind: 'customer';
      event: { code: string; name: string };
      issuedAt: string;
      amountSatang?: never;
    }
  | { kind: 'promptpay'; amountSatang: number; event?: never; issuedAt?: never }
);
export function QrCard({
  kind,
  number,
  customerName,
  qrImage,
  registrationNumber,
  recipientName,
  amountSatang,
  imageAlt,
  event,
  issuedAt,
}: Props) {
  const payment = kind === 'promptpay';
  return (
    <article className={`print-document qr-card qr-card-${kind}`} data-qr-kind={kind}>
      <div className="qr-card-details">
        <div className="qr-card-brand">
          <strong>CCIDA</strong>
          <span>{payment ? 'PROMPTPAY' : 'REGISTRATION'}</span>
        </div>
        {payment ? (
          <>
            <h2>สแกนเพื่อชำระเงิน</h2>
            <h3>{number}</h3>
            <p className={customerName.length > 70 ? 'qr-name-long' : undefined}>{customerName}</p>
            {registrationNumber && <small>{registrationNumber}</small>}
          </>
        ) : (
          <>
            <p className="qr-registration-heading">บัตรลงทะเบียน / CUSTOMER PASS</p>
            <h2 className={`qr-event-name${event!.name.length > 80 ? ' qr-event-long' : ''}`}>
              {event!.name}
            </h2>
            <p className="qr-event-code">รหัสงาน / EVENT: {event!.code}</p>
            <p className="qr-issued-at">
              ออกบัตร:{' '}
              <time dateTime={issuedAt}>
                {new Intl.DateTimeFormat('en-GB', {
                  timeZone: 'Asia/Bangkok',
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                  hourCycle: 'h23',
                }).format(new Date(issuedAt!))}
              </time>{' '}
              (ไทย)
            </p>
          </>
        )}
      </div>
      <Image
        unoptimized
        src={qrImage}
        width={480}
        height={480}
        alt={imageAlt ?? (payment ? 'Printed PromptPay QR' : 'Customer QR')}
      />
      <div className="qr-card-footer">
        {payment ? (
          <>
            <strong className="qr-card-amount">{money(amountSatang)}</strong>
            <p className="qr-card-recipient-label">ผู้รับเงิน</p>
            <p className={recipientName && recipientName.length > 70 ? 'qr-name-long' : undefined}>
              {recipientName || 'ตรวจสอบผู้รับเงินในแอปธนาคาร'}
            </p>
            <p className="qr-card-instructions">
              ใช้สำหรับรายการนี้ครั้งเดียว
              <br />
              ยังไม่ยืนยันรับเงิน · ตรวจสอบผู้รับก่อนโอน
            </p>
          </>
        ) : (
          <>
            <p className="qr-customer-label">ชื่อผู้ร่วมงาน / CUSTOMER</p>
            <strong
              className={`qr-customer-name${customerName.length > 70 ? ' qr-name-long' : ''}`}
            >
              {customerName}
            </strong>
            <p className="qr-registration-number">เลขทะเบียน: {number}</p>
            <div className="qr-registration-instructions">
              <strong>วิธีใช้บัตร / HOW TO USE</strong>
              <ol>
                <li>แสดง QR ที่จุดขายเพื่อบันทึกรายการซื้อ</li>
                <li>ใช้บัตรเดิมกับทุกรายการในงานนี้</li>
                <li>แสดงบัตรที่จุดชำระเงินก่อนออกจากงาน</li>
              </ol>
            </div>
            <p className="qr-card-help">บัตรสูญหาย: ติดต่อจุดลงทะเบียน</p>
          </>
        )}
      </div>
    </article>
  );
}
