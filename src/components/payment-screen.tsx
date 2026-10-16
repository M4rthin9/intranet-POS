'use client';
import { requestKey } from '../lib/client-key';
import { useEffect, useState, useRef } from 'react';
import { api, ApiError, useApp, money, time, isRejectedSubmission } from './context';
import {
  Printer,
  ScanLine,
  UserRound,
  ShieldCheck,
  CircleCheck,
  ArrowRight,
  ReceiptText,
  QrCode,
  Banknote,
} from 'lucide-react';
import Image from 'next/image';
import './payment-screen.css';
import { PromptPayPrint } from './promptpay-print';
import { Badge, Table } from './ui';
import { Receipt } from './receipt';
import type { AccountDto, PaymentDto, ReceiptDto, PromptPayPrintDto } from './types';
import { usePersistentIntent } from './persistent-intent';
import {
  isGenerateIntent,
  isConfirmIntent,
  type GenerateIntent,
  type ConfirmIntent,
} from './intent-schemas';
export function PaymentScreen() {
  const app = useApp();
  const { eventId, stationId, revision, notify } = app;
  const [token, setToken] = useState('');
  const [account, setAccount] = useState<AccountDto | null>(null);
  const [payment, setPayment] = useState<PaymentDto | null>(null);
  const [method, setMethod] = useState<'PROMPTPAY' | 'CASH'>('PROMPTPAY');
  const [cashReceived, setCashReceived] = useState('');
  const cash = payment?.method === 'CASH';
  const cashReceivedSatang = /^\d{1,8}(\.\d{1,2})?$/.test(cashReceived)
    ? Math.round(Number(cashReceived) * 100)
    : 0;
  const [payments, setPayments] = useState<PaymentDto[]>([]);
  const [receipt, setReceipt] = useState<ReceiptDto | null>(null);
  const [receiptBarcode, setReceiptBarcode] = useState('');
  const [promptPayPrint, setPromptPayPrint] = useState<PromptPayPrintDto | null>(null);
  const scope = `${app.user.id}:${eventId}:${stationId}`;
  const [generateIntent, setGenerateIntent, generateReady] = usePersistentIntent<GenerateIntent>(
    `ccida:payment-generate:${scope}`,
    isGenerateIntent,
  );
  const [confirmIntent, setConfirmIntent, confirmReady] = usePersistentIntent<ConfirmIntent>(
    `ccida:payment-confirm:${scope}`,
    isConfirmIntent,
  );
  const [confirmationDraft, setConfirmationDraft] = useState<ConfirmIntent | null>(null);
  const scanner = useRef<HTMLInputElement>(null);
  const acting = useRef(false);
  const [working, setWorking] = useState(false);
  const busy = app.busy || working;
  const pending = !!payment && ['PENDING', 'AWAITING_CONFIRMATION'].includes(payment.status);
  const settled = account?.status === 'SETTLED';
  function beginWork() {
    if (acting.current || app.busy) return false;
    acting.current = true;
    setWorking(true);
    return true;
  }
  function finishWork() {
    acting.current = false;
    setWorking(false);
  }
  function nextCustomer() {
    if (busy || generateIntent || confirmIntent || pending) return;
    setToken('');
    setAccount(null);
    setPayment(null);
    setMethod('PROMPTPAY');
    setCashReceived('');
    setConfirmationDraft(null);
    requestAnimationFrame(() => scanner.current?.focus());
  }
  useEffect(() => {
    if (generateReady && confirmReady) scanner.current?.focus();
  }, [generateReady, confirmReady]);
  useEffect(() => {
    if (eventId)
      api<PaymentDto[]>(`/api/data?view=payments&eventId=${eventId}`)
        .then(setPayments)
        .catch((e) => notify(e.message));
  }, [eventId, revision, notify]);
  async function scan() {
    if (!generateReady || !confirmReady || generateIntent || confirmIntent || !beginWork()) return;
    try {
      if (/^PAY-\d{8}-\d{6,20}$/.test(token.trim())) {
        setReceipt(await app.op<ReceiptDto>('receipt.print', { receiptNumber: token.trim() }));
        setToken('');
        return;
      }
      const result = await app.op<AccountDto>('account.lookup', { eventId, token: token.trim() });
      setAccount(result);
      setPayment(null);
      setCashReceived('');
    } catch {
      setAccount(null);
    } finally {
      finishWork();
    }
  }
  async function generate() {
    if (!beginWork()) return;
    const intent = generateIntent ?? {
      eventId,
      stationId,
      token: token.trim(),
      key: requestKey(),
      method,
    };
    setGenerateIntent(intent);
    try {
      const result = await app.op<PaymentDto>('payment.generate', intent);
      setMethod(result.method ?? 'PROMPTPAY');
      setToken(intent.token);
      const current = await app.op<AccountDto>('account.lookup', {
        eventId: intent.eventId,
        token: intent.token,
      });
      setAccount(current);
      const actual = current.payments.find((value) => value.id === result.id);
      setPayment({
        ...result,
        ...(actual ? { status: actual.status, confirmedAt: actual.confirmedAt } : {}),
      });
      setGenerateIntent(null);
    } catch (e) {
      if (isRejectedSubmission(e)) {
        setToken(intent.token);
        setGenerateIntent(null);
      }
    } finally {
      finishWork();
    }
  }
  async function print(id: string) {
    try {
      setReceipt(await app.op<ReceiptDto>('receipt.print', { paymentId: id }));
    } catch {
      /* Displayed by application notice. */
    }
  }
  async function previewPromptPay(id: string) {
    try {
      setPromptPayPrint(
        await app.op<PromptPayPrintDto>('payment.qr.print', { paymentId: id, stationId }),
      );
    } catch (error) {
      if (error instanceof ApiError && [404, 409].includes(error.status)) {
        setPayment(null);
        setAccount(null);
      }
    }
  }
  async function confirmPayment(intent: ConfirmIntent) {
    if (!beginWork()) return;
    setConfirmIntent(intent);
    try {
      const result = await app.op<{ payment: PaymentDto }>('payment.confirm', intent);
      setConfirmIntent(null);
      if (intent.token) setToken(intent.token);
      setConfirmationDraft(null);
      setPayment(result.payment);
      setAccount((old) =>
        old
          ? {
              ...old,
              status: 'SETTLED',
              outstandingSatang: 0,
              orders: old.orders.map((order) =>
                order.status === 'RECORDED' ? { ...order, status: 'PAID' } : order,
              ),
              payments: [
                ...old.payments.filter((value) => value.id !== result.payment.id),
                {
                  id: result.payment.id,
                  number: result.payment.number,
                  status: 'CONFIRMED',
                  amountSatang: result.payment.amountSatang,
                  confirmedAt: result.payment.confirmedAt,
                },
              ],
            }
          : old,
      );
      await print(result.payment.id);
    } catch (error) {
      if (isRejectedSubmission(error)) {
        setConfirmationDraft(intent);
        if (intent.cashReceivedSatang !== undefined)
          setCashReceived(String(intent.cashReceivedSatang / 100));
        if (intent.token) setToken(intent.token);
        setConfirmIntent(null);
      }
    } finally {
      finishWork();
    }
  }
  return (
    <>
      <div className="payment-screen" aria-busy={busy}>
        <div className="payment-heading">
          <div>
            <span className="payment-eyebrow">PAYMENT COUNTER</span>
            <h1>รับชำระเงิน</h1>
            <p>สแกนผู้ร่วมงาน เลือกพร้อมเพย์หรือเงินสด และยืนยันรับเงิน</p>
          </div>
          <ol className="payment-steps" aria-label="ขั้นตอนรับชำระเงิน">
            {['สแกน QR', 'ตรวจสอบยอด', 'ยืนยันรับเงิน'].map((label, index) => (
              <li
                key={label}
                className={
                  (settled ? 3 : pending || confirmIntent ? 2 : account ? 1 : 0) >= index
                    ? 'active'
                    : ''
                }
              >
                <span>{settled ? <CircleCheck size={15} /> : index + 1}</span>
                {label}
              </li>
            ))}
          </ol>
        </div>
        {!stationId && (
          <div className="payment-closed">ไม่มีกิจกรรมเปิดรับชำระ · พิมพ์สำเนาใบเสร็จเดิมได้</div>
        )}
        <section className="payment-scan">
          <div className="payment-scan-icon">
            <ScanLine size={25} />
          </div>
          <div className="payment-scan-body">
            <label htmlFor="payment-customer-qr">สแกน QR ผู้ร่วมงาน / ใบรายการซื้อ</label>
            <form
              className="scan-form"
              onSubmit={(e) => {
                e.preventDefault();
                void scan();
              }}
            >
              <input
                id="payment-customer-qr"
                ref={scanner}
                value={generateIntent?.token ?? confirmIntent?.token ?? token}
                disabled={
                  busy || !generateReady || !confirmReady || !!generateIntent || !!confirmIntent
                }
                onChange={(e) => {
                  setToken(e.target.value);
                  setAccount(null);
                  setPayment(null);
                  setConfirmationDraft(null);
                }}
                placeholder="สแกน QR หรือบาร์โค้ดใบเสร็จ แล้วกด Enter"
                aria-label="Customer QR"
                maxLength={100}
                autoComplete="off"
                spellCheck={false}
                required
              />
              <button
                className="primary"
                disabled={
                  busy || !generateReady || !confirmReady || !!generateIntent || !!confirmIntent
                }
              >
                <ScanLine size={18} /> ตรวจสอบบัญชี
              </button>
            </form>
            <small>
              ใช้เครื่องสแกนหรือวางรหัส QR · สแกนบาร์โค้ดใบเสร็จเพื่อพิมพ์สำเนาได้เช่นกัน
            </small>
          </div>
        </section>
        {!account && generateIntent && (
          <section className="payment-recovery">
            <p className="error">คำขอสร้าง QR ยังไม่ทราบผล · ลองส่งคำขอเดิมด้วยรหัสเดิม</p>
            <button className="primary" disabled={busy} onClick={generate}>
              ลองสร้าง QR ด้วยรายการเดิม
            </button>
          </section>
        )}
        {!payment && confirmIntent && (
          <section className="payment-recovery">
            <p className="error">คำขอยืนยันรับเงินยังไม่ทราบผล · ห้ามรับชำระซ้ำ</p>
            <p>อ้างอิง {confirmIntent.reference}</p>
            <p>{confirmIntent.evidence}</p>
            <button
              className="primary"
              disabled={busy}
              onClick={() => confirmPayment(confirmIntent)}
            >
              ลองยืนยันรายการเดิม
            </button>
          </section>
        )}
        {account ? (
          <div className="payment-layout">
            <section className="payment-account">
              <div className="payment-section-title">
                <UserRound size={19} />
                <h2>ผู้ร่วมงานและยอดชำระ</h2>
                <Badge>{account.status}</Badge>
              </div>
              <div className="payment-customer">
                <span>{account.registrationNumber}</span>
                <h3>{account.customerName}</h3>
                <Badge>{account.isVip ? 'VIP' : 'Normal'}</Badge>
                {account.scannedOrder && (
                  <p className="payment-slip-reference">
                    สแกนใบรายการซื้อ: <strong>{account.scannedOrder.number}</strong>
                  </p>
                )}
              </div>
              <div className={settled ? 'payment-balance paid' : 'payment-balance'}>
                <span>{settled ? 'ยอดค้างชำระ' : 'ยอดค้างชำระทั้งหมด'}</span>
                <strong>{money(account.outstandingSatang)}</strong>
                <small>{settled ? 'รับชำระครบแล้ว' : 'ยอดล่าสุดจากรายการซื้อในกิจกรรมนี้'}</small>
              </div>
              {!settled && (
                <fieldset
                  className="payment-method-picker"
                  disabled={busy || !!payment || !!generateIntent || !!confirmIntent}
                >
                  <legend>วิธีชำระเงิน / Payment method</legend>
                  <label>
                    <input
                      type="radio"
                      name="payment-method"
                      value="PROMPTPAY"
                      checked={method === 'PROMPTPAY'}
                      onChange={() => setMethod('PROMPTPAY')}
                    />
                    <QrCode size={18} /> QR พร้อมเพย์
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="payment-method"
                      value="CASH"
                      checked={method === 'CASH'}
                      onChange={() => setMethod('CASH')}
                    />
                    <Banknote size={18} /> เงินสด / Cash
                  </label>
                </fieldset>
              )}
              {!settled && (
                <button
                  className="primary payment-generate"
                  disabled={
                    busy ||
                    !generateReady ||
                    !confirmReady ||
                    !stationId ||
                    account.outstandingSatang === 0 ||
                    !!payment ||
                    !!confirmIntent
                  }
                  onClick={generate}
                >
                  <QrCode size={19} />
                  {generateIntent
                    ? 'ลองเตรียมรายการเดิมอีกครั้ง'
                    : method === 'CASH'
                      ? 'เตรียมรับชำระเงินสด'
                      : 'สร้าง QR พร้อมเพย์ตามยอดค้าง'}
                </button>
              )}
              <div className="payment-orders">
                <h3>
                  ลำดับรายการซื้อ <span>{account.orders.length} รายการ</span>
                </h3>
                {account.orders.length === 0 && <p className="muted">ยังไม่มีรายการซื้อ</p>}
                {account.orders.map((order) => (
                  <details
                    key={order.id}
                    className="timeline"
                    open={account.scannedOrder?.id === order.id ? true : undefined}
                  >
                    <summary>
                      <span>{time(order.createdAt)}</span>
                      <strong>{money(order.totalSatang)}</strong>
                      <Badge>{order.status}</Badge>
                    </summary>
                    <small>{order.number}</small>
                    {order.items.map((item) => (
                      <p key={item.id}>
                        {item.productNameSnapshot} × {item.quantity} · {money(item.lineTotalSatang)}
                      </p>
                    ))}
                  </details>
                ))}
              </div>
            </section>
            <section className="payment-qr">
              {settled ? (
                <div className="payment-success" role="status">
                  <span className="payment-success-icon">
                    <CircleCheck size={34} />
                  </span>
                  <h2>รับชำระเรียบร้อยแล้ว</h2>
                  <p>บัญชีนี้ชำระแล้ว / ACCOUNT ALREADY SETTLED</p>
                  <p className="muted">
                    {account.customerName} · {account.registrationNumber}
                  </p>
                  <div className="payment-success-receipts">
                    {account.payments
                      .filter((p) => p.status === 'CONFIRMED')
                      .map((p) => (
                        <div key={p.id}>
                          <div>
                            <strong>{money(p.amountSatang)}</strong>
                            <span>{p.number}</span>
                            <small>{p.confirmedAt && time(p.confirmedAt)}</small>
                          </div>
                          <button disabled={busy} onClick={() => print(p.id)}>
                            <Printer size={17} />
                            พิมพ์สำเนาใบเสร็จ
                          </button>
                        </div>
                      ))}
                  </div>
                  <button
                    className="primary payment-next"
                    disabled={busy || !!generateIntent || !!confirmIntent}
                    onClick={nextCustomer}
                  >
                    รับชำระผู้ร่วมงานถัดไป <ArrowRight size={18} />
                  </button>
                </div>
              ) : payment ? (
                pending ? (
                  <div className="payment-pending-work">
                    <div className="payment-bank-qr">
                      <div className="payment-section-title">
                        {cash ? <Banknote size={19} /> : <QrCode size={19} />}
                        <h2>{cash ? 'เงินสด / Cash' : 'QR พร้อมเพย์'}</h2>
                      </div>
                      <span className="payment-awaiting">
                        {cash ? 'รอรับเงินสด' : 'รอตรวจสอบเงินเข้า'}
                      </span>
                      <strong className="payment-qr-amount">{money(payment.amountSatang)}</strong>
                      {payment.qrImage && (
                        <div className="payment-qr-image">
                          <Image
                            src={payment.qrImage}
                            width={208}
                            height={208}
                            unoptimized
                            alt="PromptPay exact-amount QR"
                          />
                        </div>
                      )}
                      {!cash && (
                        <>
                          <span className="payment-recipient-label">ผู้รับเงิน</span>
                          <strong className="payment-recipient">
                            {payment.displayName || 'พร้อมเพย์ของกิจกรรม'}
                          </strong>
                        </>
                      )}
                      <small className="payment-number">{payment.number}</small>
                      {!cash && (
                        <>
                          <button
                            className="promptpay-print-button"
                            disabled={busy || !!generateIntent || !!confirmIntent}
                            onClick={() => previewPromptPay(payment.id)}
                          >
                            <Printer size={18} /> พิมพ์ QR พร้อมเพย์
                          </button>
                          <small className="payment-paper-hint">กระดาษ 80 มม.</small>
                        </>
                      )}
                    </div>
                    <div className="payment-evidence">
                      <div className="payment-section-title">
                        <ShieldCheck size={19} />
                        <h2>{cash ? 'ตรวจนับและยืนยันเงินสด' : 'ยืนยันเงินเข้าบัญชี'}</h2>
                      </div>
                      <p className="payment-evidence-hint">
                        {cash
                          ? 'รับเงินสดและตรวจนับเงินทอนให้ครบก่อนยืนยัน'
                          : 'ตรวจสอบผู้รับเงิน ยอดและเวลาจากธนาคารก่อนยืนยัน'}
                      </p>
                      {confirmIntent && (
                        <p className="error">ยังไม่ทราบผลคำขอ กรุณาลองยืนยันรายการเดิม</p>
                      )}
                      <form
                        key={payment.id}
                        onSubmit={async (e) => {
                          e.preventDefault();
                          const f = new FormData(e.currentTarget);
                          const intent = confirmIntent ?? {
                            paymentId: payment.id,
                            stationId,
                            key: requestKey(),
                            reference: cash ? `CASH-${payment.number}` : String(f.get('reference')),
                            evidence: cash
                              ? 'Cash counted and change verified by cashier'
                              : String(f.get('evidence')),
                            ...(cash ? { cashReceivedSatang } : {}),
                            evidenceVerified: true as const,
                            eventId,
                            token: token.trim(),
                          };
                          await confirmPayment(intent);
                        }}
                      >
                        {cash ? (
                          <>
                            <label>
                              รับเงินสด (บาท)
                              <input
                                name="cashReceived"
                                inputMode="decimal"
                                type="number"
                                min={payment.amountSatang / 100}
                                max="21474836.47"
                                step="0.01"
                                value={cashReceived}
                                onChange={(event) => setCashReceived(event.target.value)}
                                required
                                disabled={busy || !!confirmIntent}
                              />
                            </label>
                            <div className="payment-cash-change">
                              เงินทอน / Change{' '}
                              <strong>
                                {money(Math.max(0, cashReceivedSatang - payment.amountSatang))}
                              </strong>
                            </div>
                          </>
                        ) : (
                          <>
                            <label>
                              เลขอ้างอิงธนาคาร
                              <input
                                name="reference"
                                defaultValue={confirmationDraft?.reference ?? ''}
                                required
                                minLength={3}
                                maxLength={120}
                                disabled={busy || !!confirmIntent}
                                placeholder="เลขอ้างอิงจากธนาคาร / สลิป"
                                autoComplete="off"
                              />
                            </label>
                            <label>
                              รายละเอียดการตรวจสอบหลักฐาน
                              <textarea
                                name="evidence"
                                defaultValue={confirmationDraft?.evidence ?? ''}
                                required
                                minLength={3}
                                maxLength={1000}
                                disabled={busy || !!confirmIntent}
                                rows={3}
                                placeholder="เช่น ผู้รับเงินตรง ยอดและเวลาถูกต้อง"
                              />
                            </label>
                          </>
                        )}
                        <label className="checkbox payment-verified">
                          <input
                            type="checkbox"
                            name="verified"
                            required
                            disabled={busy || !!confirmIntent}
                          />
                          {cash
                            ? 'รับเงินสดและตรวจสอบเงินทอนเรียบร้อยแล้ว'
                            : 'ตรวจสอบผู้รับเงิน ยอดเงิน เวลา และหลักฐานแล้ว'}
                        </label>
                        <button
                          className="primary payment-confirm"
                          disabled={
                            busy ||
                            (cash && !confirmIntent && cashReceivedSatang < payment.amountSatang)
                          }
                        >
                          <ShieldCheck size={18} />
                          {confirmIntent ? 'ลองยืนยันรายการเดิม' : 'ยืนยันรับชำระเงิน'}
                        </button>
                        <small className="payment-confirm-hint">
                          เมื่อยืนยันแล้ว ระบบจะออกใบเสร็จ 80 มม.
                        </small>
                      </form>
                    </div>
                  </div>
                ) : (
                  <div className="payment-waiting">
                    <ReceiptText size={36} />
                    <h2>{payment.number}</h2>
                    <Badge>{payment.status}</Badge>
                    <p>รายการนี้ถูกแก้ไขแล้ว กรุณาตรวจสอบบัญชีปัจจุบัน</p>
                    <button onClick={scan} disabled={busy}>
                      ตรวจสอบบัญชีใหม่
                    </button>
                  </div>
                )
              ) : (
                <div className="payment-waiting">
                  <QrCode size={42} />
                  <h2>
                    {account.outstandingSatang > 0 ? 'เลือกวิธีชำระเงิน' : 'ยังไม่มียอดค้างชำระ'}
                  </h2>
                  <p>
                    {account.outstandingSatang > 0
                      ? 'ตรวจสอบยอดด้านซ้าย แล้วเลือก QR พร้อมเพย์หรือเงินสด'
                      : 'รายการซื้อที่บันทึกแล้วจะแสดงในบัญชีนี้'}
                  </p>
                  <small>ออกใบเสร็จหลังตรวจสอบและยืนยันรับเงินแล้ว</small>
                </div>
              )}
            </section>
          </div>
        ) : (
          !generateIntent &&
          !confirmIntent && (
            <section className="payment-start">
              <div className="payment-start-icon">
                <ScanLine size={42} />
              </div>
              <h2>พร้อมรับชำระเงิน</h2>
              <p>สแกน QR ของผู้ร่วมงานเพื่อแสดงชื่อและยอดค้างชำระ</p>
              <div className="payment-start-guide">
                <span>
                  <UserRound size={18} />
                  ตรวจสอบผู้ร่วมงาน
                </span>
                <ArrowRight size={16} />
                <span>
                  <QrCode size={18} />
                  ให้ลูกค้าสแกนพร้อมเพย์
                </span>
                <ArrowRight size={16} />
                <span>
                  <ShieldCheck size={18} />
                  ตรวจสอบเงินและออกใบเสร็จ
                </span>
              </div>
            </section>
          )
        )}
        <div className="payment-utilities">
          <details className="payment-utility receipt-reprint-panel">
            <summary>
              <Printer size={18} />
              <span>พิมพ์สำเนาใบเสร็จ</span>
              <small>ค้นหาด้วยบาร์โค้ด / เลขที่ใบเสร็จ</small>
            </summary>
            <div className="payment-utility-content">
              <form
                className="scan-form"
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (busy) return;
                  try {
                    setReceipt(
                      await app.op<ReceiptDto>('receipt.print', {
                        receiptNumber: receiptBarcode.trim(),
                      }),
                    );
                    setReceiptBarcode('');
                  } catch {
                    /* Application notice displays missing or invalid receipts. */
                  }
                }}
              >
                <input
                  aria-label="Receipt barcode"
                  placeholder="สแกนบาร์โค้ด / เลขที่ใบเสร็จ แล้วกด Enter"
                  value={receiptBarcode}
                  onChange={(event) => setReceiptBarcode(event.target.value)}
                  maxLength={50}
                  required
                  autoComplete="off"
                />
                <button disabled={busy}>ค้นหาและพิมพ์สำเนา</button>
              </form>
              <small>ค้นหาใบเสร็จที่ยืนยันรับเงินแล้ว รวมถึงกิจกรรมที่ปิดแล้ว</small>
            </div>
          </details>
          <details className="payment-utility payment-history">
            <summary>
              <ReceiptText size={18} />
              <span>ประวัติการชำระเงิน</span>
              <small>ดูรายการและพิมพ์ย้อนหลัง</small>
            </summary>
            <div className="payment-utility-content">
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
                  {
                    label: 'วิธีชำระ',
                    render: (p) => (p.method === 'CASH' ? 'เงินสด' : 'PromptPay'),
                  },
                  { label: 'สถานะ', render: (p) => <Badge>{p.status}</Badge> },
                  {
                    label: 'จัดการ',
                    render: (p) =>
                      p.status === 'CONFIRMED' ? (
                        <button disabled={busy} onClick={() => print(p.id)}>
                          พิมพ์ / สำเนา
                        </button>
                      ) : p.method !== 'CASH' &&
                        ['PENDING', 'AWAITING_CONFIRMATION'].includes(p.status) ? (
                        <button
                          disabled={busy || !!generateIntent || !!confirmIntent}
                          onClick={() => previewPromptPay(p.id)}
                        >
                          พิมพ์ QR พร้อมเพย์
                        </button>
                      ) : null,
                  },
                ]}
              />
            </div>
          </details>
        </div>
      </div>
      {receipt && <Receipt receipt={receipt} onClose={() => setReceipt(null)} />}
      {promptPayPrint && (
        <PromptPayPrint
          value={promptPayPrint}
          onClose={() => setPromptPayPrint(null)}
          onInvalid={() => {
            setPayment(null);
            setAccount(null);
          }}
        />
      )}
    </>
  );
}
