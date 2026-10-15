'use client';
import { useEffect, useState } from 'react';
import { ExternalLink, Star, MessageSquareHeart } from 'lucide-react';
import { api, time, useApp } from './context';
import { feedbackCategories } from '../lib/feedback-schema';
import type { FeedbackResults } from '../lib/feedback';
import './feedback.css';

export function FeedbackScreen() {
  const { events, notify, revision } = useApp();
  const [eventId, setEventId] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<FeedbackResults | null>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api<FeedbackResults>(
      `/api/feedback?page=${page}${eventId ? `&eventId=${encodeURIComponent(eventId)}` : ''}`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((error) => {
        if (!controller.signal.aborted) notify(error.message);
      });
    return () => controller.abort();
  }, [eventId, page, revision, refresh, notify]);
  return (
    <div className="feedback-review">
      <div className="feedback-review-heading">
        <div>
          <span className="feedback-eyebrow">CUSTOMER VOICE</span>
          <h1>ความคิดเห็นจากผู้ใช้บริการ</h1>
          <p>รับฟังประสบการณ์และนำข้อเสนอแนะไปพัฒนาการบริการ</p>
        </div>
        <button onClick={() => setRefresh((value) => value + 1)}>รีเฟรชข้อมูล</button>
      </div>
      <section className="panel feedback-review-share">
        <MessageSquareHeart size={25} aria-hidden="true" />
        <div>
          <h2>แบบประเมินสำหรับผู้ใช้บริการ</h2>
          <p>คัดลอกลิงก์นี้ไปตั้งค่า QR ท้ายใบเสร็จ ผู้ตอบไม่ต้องเข้าสู่ระบบ</p>
          {data?.acceptingFeedback && (
            <input
              aria-label="ลิงก์แบบประเมิน"
              readOnly
              value={data.feedbackUrl}
              onFocus={(event) => event.currentTarget.select()}
            />
          )}
        </div>
        {data?.acceptingFeedback && (
          <a href={data.feedbackUrl} target="_blank" rel="noopener noreferrer">
            เปิดแบบประเมิน <ExternalLink size={16} />
          </a>
        )}
        <a href="/settings">ตั้งค่า QR บนใบเสร็จ</a>
        {data && !data.acceptingFeedback && (
          <p>กิจกรรมนี้ยังไม่เปิดรับหรือเก็บเข้าคลังแล้ว จึงดูได้เฉพาะความคิดเห็นเดิม</p>
        )}
      </section>
      <label className="feedback-review-filter">
        กิจกรรม
        <select
          aria-label="กรองความคิดเห็นตามกิจกรรม"
          value={eventId}
          onChange={(event) => {
            setEventId(event.target.value);
            setPage(1);
            setData(null);
          }}
        >
          <option value="">ทุกกิจกรรมและความคิดเห็นทั่วไป</option>
          {events.map((event) => (
            <option key={event.id} value={event.id}>
              {event.code} · {event.name}
            </option>
          ))}
        </select>
      </label>
      {data ? (
        <>
          <div className="kpis feedback-review-kpis">
            {[
              ['ความคิดเห็นทั้งหมด', data.total],
              [
                'คะแนนเฉลี่ย',
                data.average.rating === null ? '—' : `${data.average.rating.toFixed(1)} / 5`,
              ],
              [
                'การบริการ / ความรวดเร็ว',
                `${data.average.serviceRating?.toFixed(1) ?? '—'} / ${data.average.speedRating?.toFixed(1) ?? '—'}`,
              ],
              ['คะแนน 1–2 ดาว', data.lowRatings],
            ].map(([label, value]) => (
              <section className="kpi" key={label}>
                <div>
                  {label}
                  <Star size={16} />
                </div>
                <strong>{value}</strong>
              </section>
            ))}
          </div>
          <section className="panel feedback-distribution" aria-label="การกระจายคะแนน">
            {[5, 4, 3, 2, 1].map((rating) => {
              const count = data.distribution.find((row) => row.rating === rating)?.count ?? 0;
              return (
                <div key={rating}>
                  <span>{rating} ดาว</span>
                  <progress
                    max={Math.max(data.total, 1)}
                    value={count}
                    aria-label={`${rating} ดาว ${count} ความคิดเห็น`}
                  />
                  <strong>{count}</strong>
                </div>
              );
            })}
          </section>
          <div className="feedback-response-list">
            {data.rows.length ? (
              data.rows.map((row) => (
                <article className="panel feedback-response" key={row.id}>
                  <header>
                    <div className="feedback-response-score">
                      <Star size={16} />
                      {row.rating}/5
                    </div>
                    <strong>
                      {feedbackCategories[row.category as keyof typeof feedbackCategories]}
                    </strong>
                    <time dateTime={row.createdAt}>{time(row.createdAt)}</time>
                  </header>
                  <p className="feedback-response-event">
                    {row.event ? `${row.event.code} · ${row.event.name}` : 'ความคิดเห็นทั่วไป'}
                  </p>
                  {row.message ? (
                    <p className="feedback-response-message">{row.message}</p>
                  ) : (
                    <p className="muted">ให้คะแนนโดยไม่มีข้อความเพิ่มเติม</p>
                  )}
                  <footer>
                    <span>{row.customerName || 'ไม่ระบุชื่อ'}</span>
                    {row.contact && <span>ข้อมูลติดต่อ: {row.contact}</span>}
                    {(row.serviceRating || row.speedRating) && (
                      <span>
                        บริการ {row.serviceRating ?? '—'}/5 · ความรวดเร็ว {row.speedRating ?? '—'}/5
                      </span>
                    )}
                  </footer>
                </article>
              ))
            ) : (
              <section className="panel empty">ยังไม่มีความคิดเห็นในรายการนี้</section>
            )}
          </div>
          <div className="feedback-pagination">
            <button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
              ก่อนหน้า
            </button>
            <span>
              หน้า {data.page} / {data.pages}
            </span>
            <button disabled={page >= data.pages} onClick={() => setPage((value) => value + 1)}>
              ถัดไป
            </button>
          </div>
        </>
      ) : (
        <section className="panel empty" role="status">
          กำลังโหลดความคิดเห็น
        </section>
      )}
    </div>
  );
}
