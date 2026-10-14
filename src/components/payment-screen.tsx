'use client';
import { requestKey } from '../lib/client-key';
import { useEffect, useState, useRef } from 'react';
import Image from 'next/image';
import { api, useApp, money, time, ApiError } from './context';
import { Badge, Table } from './ui';
import { Receipt } from './receipt';
import type { AccountDto, PaymentDto, ReceiptDto } from './types';
type GenerateIntent = { eventId: string; stationId: string; token: string; key: string };
type ConfirmIntent = {
  paymentId: string;
  stationId: string;
  key: string;
  reference: string;
  evidence: string;
  evidenceVerified: true;
};
export function PaymentScreen() {
  const app = useApp();
  const { eventId, stationId, revision, notify } = app;
  const [token, setToken] = useState('');
  const [account, setAccount] = useState<AccountDto | null>(null);
  const [payment, setPayment] = useState<PaymentDto | null>(null);
  const [payments, setPayments] = useState<PaymentDto[]>([]);
  const [receipt, setReceipt] = useState<ReceiptDto | null>(null);
  const [generateIntent, setGenerateIntent] = useState<GenerateIntent | null>(null);
  const [confirmIntent, setConfirmIntent] = useState<ConfirmIntent | null>(null);
  const scanner = useRef<HTMLInputElement>(null);
  useEffect(() => {
    scanner.current?.focus();
  }, []);
  useEffect(() => {
    if (eventId)
      api<PaymentDto[]>(`/api/data?view=payments&eventId=${eventId}`)
        .then(setPayments)
        .catch((e) => notify(e.message));
  }, [eventId, revision, notify]);
  async function scan() {
    try {
      const result = await app.op<AccountDto>('account.lookup', { eventId, token: token.trim() });
      setAccount(result);
      setPayment(null);
    } catch {
      setAccount(null);
    }
  }
  async function generate() {
    const intent = generateIntent ?? {
      eventId,
      stationId,
      token: token.trim(),
      key: requestKey(),
    };
    setGenerateIntent(intent);
    try {
      setPayment(await app.op<PaymentDto>('payment.generate', intent));
      setGenerateIntent(null);
    } catch (e) {
      if (e instanceof ApiError && e.status > 0 && e.status < 500) setGenerateIntent(null);
    }
  }
  async function print(id: string) {
    try {
      setReceipt(await app.op<ReceiptDto>('receipt.print', { paymentId: id }));
    } catch {
      /* Displayed by application notice. */
    }
  }
  return (
    <>
      <section className="panel">
        <h2>สแกน QR เพื่อรวมยอดชำระ</h2>
        <form
          className="scan-form"
          onSubmit={(e) => {
            e.preventDefault();
            scan();
          }}
        >
          <input
            ref={scanner}
            value={token}
            disabled={!!generateIntent || !!confirmIntent}
            onChange={(e) => {
              setToken(e.target.value);
              setAccount(null);
              setPayment(null);
            }}
            placeholder="สแกน QR ผู้ร่วมงาน แล้วกด Enter"
            aria-label="Customer QR"
            maxLength={100}
            autoComplete="off"
          />
          <button disabled={app.busy || !!generateIntent || !!confirmIntent}>ตรวจสอบบัญชี</button>
        </form>
      </section>
      {account && (
        <div className="split">
          <section className="panel">
            <h2>
              {account.registrationNumber} · {account.customerName}
            </h2>
            <Badge>{account.status}</Badge>
            {account.status === 'SETTLED' ? (
              <div className="settled">
                <h3>บัญชีนี้ชำระแล้ว / ACCOUNT ALREADY SETTLED</h3>
                {account.payments
                  .filter((p) => p.status === 'CONFIRMED')
                  .map((p) => (
                    <div key={p.id}>
                      <p>
                        {p.number} · {money(p.amountSatang)}
                        <small>{p.confirmedAt && time(p.confirmedAt)}</small>
                      </p>
                      <button onClick={() => print(p.id)}>พิมพ์สำเนาใบเสร็จ</button>
                    </div>
                  ))}
              </div>
            ) : (
              <>
                <div className="outstanding-total">
                  <small>ยอดค้างชำระจากฐานข้อมูลส่วนกลาง</small>
                  <strong>{money(account.outstandingSatang)}</strong>
                </div>
                <button
                  className="primary"
                  disabled={app.busy || !stationId || account.outstandingSatang === 0 || !!payment}
                  onClick={generate}
                >
                  {generateIntent ? 'ลองสร้าง QR ด้วยรายการเดิม' : 'สร้าง QR พร้อมเพย์ตามยอดค้าง'}
                </button>
                <p className="muted">สร้าง QR แล้วต้องตรวจสอบหลักฐานและยืนยันการรับเงิน</p>
              </>
            )}
            <h3>ลำดับรายการซื้อ</h3>
            {account.orders.map((o) => (
              <details key={o.id} className="timeline">
                <summary>
                  <span>
                    {time(o.createdAt)} · {o.station.code}
                  </span>
                  <strong>{money(o.totalSatang)}</strong>
                  <Badge>{o.status}</Badge>
                </summary>
                {o.items.map((i) => (
                  <p key={i.id}>
                    {i.productNameSnapshot} × {i.quantity} · {money(i.lineTotalSatang)}
                  </p>
                ))}
              </details>
            ))}
          </section>
          <section className="panel payment-qr">
            {payment ? (
              <>
                <Badge>{payment.status}</Badge>
                <h2>{payment.number}</h2>
                {payment.qrImage && (
                  <Image
                    unoptimized
                    src={payment.qrImage}
                    width={260}
                    height={260}
                    alt="PromptPay exact-amount QR"
                  />
                )}
                <h3>{money(payment.amountSatang)}</h3>
                <p>{payment.displayName}</p>
                {payment.status === 'CONFIRMED' ? (
                  <button onClick={() => print(payment.id)}>พิมพ์ใบเสร็จ</button>
                ) : (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      const intent = confirmIntent ?? {
                        paymentId: payment.id,
                        stationId,
                        key: requestKey(),
                        reference: String(f.get('reference')),
                        evidence: String(f.get('evidence')),
                        evidenceVerified: true as const,
                      };
                      setConfirmIntent(intent);
                      try {
                        const result = await app.op<{ payment: PaymentDto }>(
                          'payment.confirm',
                          intent,
                        );
                        setConfirmIntent(null);
                        setPayment(result.payment);
                        setAccount((old) =>
                          old ? { ...old, status: 'SETTLED', outstandingSatang: 0 } : old,
                        );
                        await print(result.payment.id);
                      } catch (error) {
                        if (error instanceof ApiError && error.status > 0 && error.status < 500)
                          setConfirmIntent(null);
                      }
                    }}
                  >
                    <label>
                      เลขอ้างอิงธนาคาร
                      <input
                        name="reference"
                        required
                        minLength={3}
                        maxLength={120}
                        disabled={!!confirmIntent}
                      />
                    </label>
                    <label>
                      รายละเอียดการตรวจสอบหลักฐาน
                      <textarea
                        name="evidence"
                        required
                        minLength={3}
                        maxLength={1000}
                        disabled={!!confirmIntent}
                      />
                    </label>
                    <label className="checkbox">
                      <input type="checkbox" name="verified" required disabled={!!confirmIntent} />{' '}
                      ตรวจสอบผู้รับเงิน ยอดเงิน เวลา และหลักฐานแล้ว
                    </label>
                    <button className="primary" disabled={app.busy}>
                      {confirmIntent ? 'ลองยืนยันรายการเดิม' : 'ยืนยันรับชำระเงิน'}
                    </button>
                  </form>
                )}
              </>
            ) : (
              <div className="empty">QR พร้อมเพย์จะแสดงหลังรวมยอดค้างชำระ</div>
            )}
          </section>
        </div>
      )}
      <section className="panel">
        <h2>ประวัติการชำระเงินในกิจกรรม</h2>
        <Table
          rows={payments}
          columns={[
            { label: 'การชำระ', render: (p) => p.number },
            {
              label: 'ผู้ร่วมงาน',
              render: (p) => (
                <>
                  {p.account?.registration.number}
                  <small>{p.account?.registration.customerName}</small>
                </>
              ),
            },
            { label: 'ยอด', render: (p) => money(p.amountSatang) },
            { label: 'สถานะ', render: (p) => <Badge>{p.status}</Badge> },
            {
              label: 'จัดการ',
              render: (p) =>
                p.status === 'CONFIRMED' ? (
                  <button onClick={() => print(p.id)}>พิมพ์ / สำเนา</button>
                ) : null,
            },
          ]}
        />
      </section>
      {receipt && <Receipt receipt={receipt} onClose={() => setReceipt(null)} />}
    </>
  );
}
