import { NextRequest } from 'next/server';
import { z } from 'zod';
import { authenticate } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { db, transaction } from '@/lib/db';
import { audit } from '@/lib/audit';
import { report } from '@/lib/reports';
import { csvRow } from '@/lib/csv';
import { bahtString } from '@/lib/money';
import { errorResponse } from '@/lib/http';
import { reportRange, paymentReportWhere } from '@/lib/report-range';
export async function GET(request: NextRequest) {
  try {
    const actor = await authenticate(request.cookies.get('ccida_session')?.value);
    requirePermission(actor.roleName, 'report.view');
    const q = request.nextUrl.searchParams;
    const eventId = z.string().uuid().parse(q.get('eventId'));
    const type = z
      .enum([
        'summary',
        'products',
        'categories',
        'stations',
        'cashiers',
        'payments',
        'outstanding',
        'registrations',
        'voids',
        'shifts',
        'stock',
      ])
      .parse(q.get('type'));
    const summary = await report(
      actor,
      eventId,
      q.get('from') ?? undefined,
      q.get('to') ?? undefined,
    );
    const rows: unknown[][] = [];
    if (['products', 'categories', 'stations', 'cashiers'].includes(type)) {
      rows.push(['รายการ', 'จำนวน', 'ยอดขาย THB']);
      const metrics =
        type === 'products'
          ? summary.byProduct
          : type === 'categories'
            ? summary.byCategory
            : type === 'stations'
              ? summary.byStation
              : summary.byCashier;
      for (const r of metrics) rows.push([r.label, r.quantity, bahtString(r.amountSatang)]);
    } else if (type === 'outstanding') {
      rows.push(['ทะเบียน', 'ผู้ร่วมงาน', 'สถานะ', 'ยอดค้าง THB', 'ซื้อล่าสุด']);
      for (const r of summary.outstanding)
        rows.push([
          r.registrationNumber,
          r.customerName,
          r.status,
          bahtString(r.amountSatang),
          r.lastPurchase,
        ]);
    } else if (type === 'summary') {
      rows.push(['รายการ', 'ค่า']);
      for (const [key, value] of Object.entries(summary)) {
        if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string')
          rows.push([key, key.endsWith('Satang') ? bahtString(Number(value)) : value]);
      }
    } else {
      const from = q.get('from');
      const to = q.get('to');
      const { createdAt: range } = reportRange(from ?? undefined, to ?? undefined);
      if (type === 'stock') {
        rows.push(['สินค้า', 'ยอดเปิด', 'ขายสุทธิ', 'ปรับปรุง', 'คงเหลือ']);
        for (const r of await db.inventory.findMany({
          where: { eventId },
          include: { product: true },
        }))
          rows.push([
            r.product.name,
            r.openingStock,
            r.soldQuantity,
            r.adjustments,
            r.remainingStock,
          ]);
      }
      if (type === 'payments') {
        rows.push(['หมายเลข', 'สถานะ', 'ยอด THB', 'อ้างอิง', 'เวลา', 'จุดบริการ', 'ผู้รับชำระ']);
        for (const p of await db.payment.findMany({
          where: paymentReportWhere(eventId, range),
          include: { station: true, user: { select: { username: true } } },
          orderBy: { createdAt: 'asc' },
        }))
          rows.push([
            p.number,
            p.status,
            bahtString(p.amountSatang),
            p.reference,
            (['VOIDED', 'REFUNDED'].includes(p.status)
              ? p.voidedAt
              : p.confirmedAt
            )?.toISOString() ?? p.createdAt.toISOString(),
            p.station.code,
            p.user.username,
          ]);
      }
      if (type === 'registrations') {
        rows.push(['ทะเบียน', 'ชื่อ', 'กลุ่ม', 'โต๊ะ', 'จำนวน', 'สถานะ', 'ลงทะเบียนเมื่อ']);
        for (const r of await db.registration.findMany({
          where: { eventId, ...(from || to ? { createdAt: range } : {}) },
          include: { account: true },
          orderBy: { createdAt: 'asc' },
        }))
          rows.push([
            r.number,
            r.customerName,
            r.group,
            r.tableNumber,
            r.guestCount,
            r.account?.status,
            r.createdAt.toISOString(),
          ]);
      }
      if (type === 'voids') {
        rows.push(['ชนิด', 'หมายเลข', 'ยอด THB', 'เหตุผล', 'เวลา', 'ผู้ยกเลิก']);
        for (const o of await db.order.findMany({
          where: { eventId, status: 'VOIDED', ...(from || to ? { voidedAt: range } : {}) },
        }))
          rows.push([
            'ORDER',
            o.number,
            bahtString(o.totalSatang),
            o.voidReason,
            o.voidedAt?.toISOString(),
            o.voidedBy,
          ]);
        for (const p of await db.payment.findMany({
          where: {
            eventId,
            status: { in: ['VOIDED', 'REFUNDED'] },
            ...(from || to ? { voidedAt: range } : {}),
          },
        }))
          rows.push([
            'PAYMENT',
            p.number,
            bahtString(p.amountSatang),
            p.voidReason,
            p.voidedAt?.toISOString(),
            p.voidedBy,
          ]);
      }
      if (type === 'shifts') {
        rows.push(['กะ', 'ผู้ปฏิบัติ', 'จุดบริการ', 'เปิด', 'ปิด', 'สรุป']);
        for (const s of await db.shift.findMany({
          where: { eventId, ...(from || to ? { openedAt: range } : {}) },
          include: { station: true, user: { select: { username: true } } },
          orderBy: { openedAt: 'asc' },
        }))
          rows.push([
            s.id,
            s.user.username,
            s.station.code,
            s.openedAt.toISOString(),
            s.closedAt?.toISOString(),
            JSON.stringify(s.summary),
          ]);
      }
    }
    await transaction((tx) =>
      audit(tx, actor, 'REPORT_EXPORT', 'Event', eventId, {
        eventId,
        after: { type, rows: rows.length - 1 },
      }),
    );
    return new Response('\uFEFF' + rows.map(csvRow).join(''), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="ccida-${type}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
