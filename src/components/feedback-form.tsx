'use client';
import { useRef, useState } from 'react';
import Image from 'next/image';
import { CheckCircle2, MessageSquareHeart, Send, ShieldCheck, Star } from 'lucide-react';
import { api, ApiError } from './context';
import { requestKey } from '../lib/client-key';
import {
  feedbackCategories,
  feedbackInputSchema,
  isFeedbackInput,
  type FeedbackInput,
} from '../lib/feedback-schema';
import { usePersistentIntent } from './persistent-intent';
import './feedback.css';

const ratingLabels = ['ควรปรับปรุง', 'พอใช้', 'ปานกลาง', 'ดี', 'ดีมาก'];
export function FeedbackForm({
  organization,
  logo,
  events,
  selectedEventId,
}: {
  organization: string;
  logo: string;
  events: { id: string; code: string; name: string }[];
  selectedEventId: string;
}) {
  const [pending, persist, ready] = usePersistentIntent<FeedbackInput>(
    'ccida:feedback-intent',
    isFeedbackInput,
  );
  const [draft, setDraft] = useState<FeedbackInput | null>(null);
  const [rating, setRating] = useState(0);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [rejected, setRejected] = useState(false);
  const submitting = useRef(false);
  const values = pending ?? draft;
  return (
    <main className="customer-feedback">
      <div className="feedback-shell">
        <header className="feedback-brand">
          {logo ? (
            <Image src={logo} alt="โลโก้หน่วยงาน" width={80} height={64} unoptimized />
          ) : (
            <MessageSquareHeart size={42} aria-hidden="true" />
          )}
          <span>{organization}</span>
        </header>
        {sent ? (
          <section className="feedback-thanks" aria-live="polite">
            <CheckCircle2 size={56} aria-hidden="true" />
            <span className="feedback-eyebrow">FEEDBACK RECEIVED</span>
            <h1>ขอบคุณสำหรับความคิดเห็น</h1>
            <p>
              เราบันทึกความคิดเห็นของคุณเรียบร้อยแล้ว
              <br />
              ทุกข้อเสนอแนะจะนำไปใช้พัฒนาการให้บริการ
            </p>
            <small>คุณสามารถปิดหน้านี้ได้</small>
          </section>
        ) : (
          <>
            <div className="feedback-intro">
              <span className="feedback-eyebrow">YOUR EXPERIENCE MATTERS</span>
              <h1>วันนี้เป็นอย่างไรบ้าง?</h1>
              <p>แบ่งปันประสบการณ์ของคุณ เพื่อให้เราบริการได้ดีขึ้น</p>
              <span className="feedback-time">ใช้เวลาประมาณ 1 นาที · ไม่ต้องเข้าสู่ระบบ</span>
            </div>
            <form
              key={pending?.key ?? 'draft'}
              onSubmit={async (event) => {
                event.preventDefault();
                if (!ready || submitting.current) return;
                submitting.current = true;
                setBusy(true);
                setError('');
                setRejected(false);
                try {
                  const data = new FormData(event.currentTarget);
                  const payload =
                    pending ??
                    feedbackInputSchema.parse({
                      key: requestKey(),
                      eventId: data.get('eventId') || null,
                      rating: Number(data.get('rating')),
                      serviceRating: data.get('serviceRating')
                        ? Number(data.get('serviceRating'))
                        : null,
                      speedRating: data.get('speedRating') ? Number(data.get('speedRating')) : null,
                      category: data.get('category'),
                      message: data.get('message'),
                      customerName: data.get('customerName') ?? '',
                      contact: data.get('contact') ?? '',
                      website: data.get('website') ?? '',
                    });
                  if (!pending) persist(payload);
                  await api('/api/feedback', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                  });
                  persist(null);
                  setSent(true);
                } catch (failure) {
                  setError(
                    failure instanceof ApiError
                      ? failure.message
                      : 'กรุณาตรวจสอบคะแนนและข้อมูล แล้วลองอีกครั้ง',
                  );
                  setRejected(
                    failure instanceof ApiError && [400, 404, 422].includes(failure.status),
                  );
                } finally {
                  submitting.current = false;
                  setBusy(false);
                }
              }}
            >
              <fieldset disabled={!ready || busy || !!pending} className="feedback-fields">
                <section className="feedback-section">
                  <div className="feedback-section-heading">
                    <span>01</span>
                    <h2>ประสบการณ์โดยรวม</h2>
                    <small>จำเป็น</small>
                  </div>
                  {events.length > 0 && (
                    <label className="feedback-label">
                      กิจกรรมที่ใช้บริการ
                      <select
                        name="eventId"
                        aria-label="กิจกรรมที่ใช้บริการ"
                        defaultValue={values?.eventId ?? selectedEventId}
                      >
                        <option value="">ความคิดเห็นทั่วไป / ไม่ระบุกิจกรรม</option>
                        {events.map((event) => (
                          <option key={event.id} value={event.id}>
                            {event.code} · {event.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <fieldset className="feedback-rating">
                    <legend>คุณพึงพอใจกับการใช้บริการมากน้อยเพียงใด?</legend>
                    <div className="feedback-rating-options">
                      {ratingLabels.map((label, index) => (
                        <label
                          key={label}
                          className={(pending?.rating ?? rating) === index + 1 ? 'chosen' : ''}
                        >
                          <input
                            type="radio"
                            name="rating"
                            value={index + 1}
                            required
                            checked={(pending?.rating ?? rating) === index + 1}
                            onChange={() => setRating(index + 1)}
                            aria-label={`${index + 1} ดาว · ${label}`}
                          />
                          <Star size={25} aria-hidden="true" />
                          <strong>{index + 1}</strong>
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <div className="feedback-detail-ratings">
                    {[
                      ['serviceRating', 'การดูแลและบริการ'],
                      ['speedRating', 'ความรวดเร็ว'],
                    ].map(([name, label]) => (
                      <label className="feedback-label" key={name}>
                        {label}
                        <small>ไม่บังคับ</small>
                        <select
                          name={name}
                          aria-label={label}
                          defaultValue={values?.[name as 'serviceRating' | 'speedRating'] ?? ''}
                        >
                          <option value="">เลือกคะแนน</option>
                          {ratingLabels.map((text, index) => (
                            <option key={text} value={index + 1}>
                              {index + 1} · {text}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                </section>
                <section className="feedback-section">
                  <div className="feedback-section-heading">
                    <span>02</span>
                    <h2>สิ่งที่อยากบอกเรา</h2>
                    <small>ไม่บังคับ</small>
                  </div>
                  <fieldset className="feedback-category">
                    <legend>ประเภทความคิดเห็น</legend>
                    {Object.entries(feedbackCategories).map(([value, label]) => (
                      <label key={value}>
                        <input
                          type="radio"
                          name="category"
                          value={value}
                          defaultChecked={(values?.category ?? 'SUGGESTION') === value}
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </fieldset>
                  <label className="feedback-label">
                    ความคิดเห็นเพิ่มเติม
                    <textarea
                      name="message"
                      maxLength={2000}
                      rows={4}
                      defaultValue={values?.message ?? ''}
                      placeholder="สิ่งที่ประทับใจ หรือสิ่งที่อยากให้เราปรับปรุง…"
                    />
                    <small>
                      ไม่เกิน 2,000 ตัวอักษร · กรุณาไม่ระบุข้อมูลการชำระเงินหรือรหัสผ่าน
                    </small>
                  </label>
                  <details
                    className="feedback-contact"
                    open={values?.contact || values?.customerName ? true : undefined}
                  >
                    <summary>
                      ฝากข้อมูลติดต่อ <span>ไม่บังคับ</span>
                    </summary>
                    <p>เว้นว่างได้ หากต้องการส่งความคิดเห็นโดยไม่ระบุชื่อ</p>
                    <label className="feedback-label">
                      ชื่อของคุณ
                      <input
                        name="customerName"
                        autoComplete="name"
                        maxLength={120}
                        defaultValue={values?.customerName ?? ''}
                      />
                    </label>
                    <label className="feedback-label">
                      เบอร์โทรศัพท์หรืออีเมล
                      <input
                        name="contact"
                        autoComplete="off"
                        maxLength={200}
                        defaultValue={values?.contact ?? ''}
                      />
                    </label>
                  </details>
                  <div className="feedback-trap" aria-hidden="true">
                    <label>
                      Website
                      <input name="website" tabIndex={-1} autoComplete="off" />
                    </label>
                  </div>
                </section>
              </fieldset>
              {pending && !busy && (
                <p className="feedback-pending" role="status">
                  เก็บความคิดเห็นเดิมไว้แล้ว หากยังไม่ได้รับคำยืนยัน ให้ลองส่งรายการเดิมอีกครั้ง
                </p>
              )}
              {error && (
                <div className="feedback-error" role="alert">
                  {error}
                  {rejected && pending && (
                    <button
                      type="button"
                      onClick={() => {
                        setDraft(pending);
                        setRating(pending.rating);
                        persist(null);
                        setError('');
                      }}
                    >
                      แก้ไขข้อมูล
                    </button>
                  )}
                </div>
              )}
              <button type="submit" className="feedback-submit" disabled={busy || !ready}>
                {busy
                  ? 'กำลังส่งความคิดเห็น…'
                  : pending
                    ? 'ลองส่งความคิดเห็นเดิมอีกครั้ง'
                    : 'ส่งความคิดเห็น'}
                <Send size={18} aria-hidden="true" />
              </button>
              <p className="feedback-privacy">
                <ShieldCheck size={16} aria-hidden="true" />
                รายละเอียดความคิดเห็นแสดงเฉพาะผู้ดูแลระบบสูงสุด
              </p>
            </form>
          </>
        )}
        <footer className="feedback-footer">CCIDA · ใส่ใจทุกประสบการณ์ของคุณ</footer>
      </div>
    </main>
  );
}
