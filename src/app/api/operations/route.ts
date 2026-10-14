import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/auth';
import { manage } from '@/lib/management';
import { checkOrigin, errorResponse, readJson } from '@/lib/http';
import { z } from 'zod';
import { registrationAction } from '@/lib/registration';
import { catalogAction } from '@/lib/catalog';
import { orderAction } from '@/lib/orders';
import { paymentAction } from '@/lib/payments';
import { controlAction } from '@/lib/controls';
import { operationsAction } from '@/lib/operations';
export async function POST(request: NextRequest) {
  try {
    checkOrigin(request);
    const user = await authenticate(request.cookies.get('ccida_session')?.value);
    const { action, input } = z
      .object({ action: z.string().max(80), input: z.unknown() })
      .parse(await readJson(request));
    const actor = {
      ...user,
      ipAddress: request.headers.get('x-real-ip') ?? undefined,
      userAgent: request.headers.get('user-agent') ?? undefined,
    };
    const handler = [
      'shift.close',
      'stock.open',
      'stock.adjust',
      'event.close',
      'event.archive',
    ].includes(action)
      ? operationsAction
      : ['order.void', 'payment.void', 'payment.refund', 'account.reopen'].includes(action)
        ? controlAction
        : /^(event|registration|qr)\./.test(action)
          ? registrationAction
          : /^(payment|promptpay|receipt)\./.test(action)
            ? paymentAction
            : /^(category|product)\./.test(action)
              ? catalogAction
              : /^(order|account|shift)\./.test(action)
                ? orderAction
                : manage;
    return NextResponse.json(await handler(actor, action, input), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
