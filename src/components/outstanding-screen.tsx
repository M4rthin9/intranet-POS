'use client';
import { useState } from 'react';
import { useSummary } from './dashboard-screen';
import { money, time } from './context';
import { Table, Badge } from './ui';
export function OutstandingScreen() {
  const data = useSummary();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState('amount');
  const rows = (data?.outstanding ?? [])
    .filter(
      (r) =>
        (status === 'all' || r.status === status) &&
        `${r.registrationNumber} ${r.customerName}`.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      sort === 'amount'
        ? b.amountSatang - a.amountSatang
        : sort === 'age'
          ? a.lastPurchase.localeCompare(b.lastPurchase)
          : a.registrationNumber.localeCompare(b.registrationNumber),
    );
  return (
    <>
      <section className="panel">
        <div className="outstanding-header">
          <div>
            <small>บัญชียังไม่ชำระ</small>
            <strong>{data?.outstandingAccounts ?? 0} บัญชี</strong>
          </div>
          <div>
            <small>ยอดค้างทั้งหมด</small>
            <strong>{money(data?.outstandingSatang ?? 0)}</strong>
          </div>
        </div>
        <div className="report-filters">
          <input
            placeholder="ค้นหาทะเบียน / ชื่อ"
            aria-label="ค้นหายอดค้าง"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select aria-label="สถานะ" value={status} onChange={(e) => setStatus(e.target.value)}>
            {['all', 'ACTIVE', 'BLOCKED', 'SETTLED', 'CANCELLED', 'EXPIRED'].map((s) => (
              <option key={s} value={s}>
                {s === 'all' ? 'ทุกสถานะ' : s}
              </option>
            ))}
          </select>
          <select aria-label="เรียงลำดับ" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="amount">ยอดค้างมากก่อน</option>
            <option value="age">รายการเก่าก่อน</option>
            <option value="number">เลขทะเบียน</option>
          </select>
        </div>
      </section>
      <section className="panel">
        <Table
          rows={rows}
          columns={[
            { label: 'ทะเบียน', render: (r) => r.registrationNumber },
            { label: 'ผู้ร่วมงาน', render: (r) => r.customerName },
            { label: 'สถานะ', render: (r) => <Badge>{r.status}</Badge> },
            { label: 'รายการค้าง', render: (r) => r.orders },
            {
              label: 'ยอดค้าง',
              render: (r) => <strong className="balance">{money(r.amountSatang)}</strong>,
            },
            {
              label: 'ซื้อล่าสุด',
              render: (r) => (
                <>
                  {time(r.lastPurchase)}
                  <small>
                    ผ่านมา{' '}
                    {Math.max(
                      0,
                      Math.floor((Date.now() - new Date(r.lastPurchase).getTime()) / 60000),
                    )}{' '}
                    นาที
                  </small>
                </>
              ),
            },
          ]}
        />
        <small>อัปเดตทุก 5 วินาที · {data && time(data.asOf)}</small>
      </section>
    </>
  );
}
