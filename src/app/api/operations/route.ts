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
import { resolveOperatingContext } from '@/lib/operating-context';
import { AppError } from '@/lib/rbac';
import { eventSalesAction } from '@/lib/event-sales-clear';
export async function POST(request: NextRequest) {
  let operation = 'unknown';
  try {
    checkOrigin(request);
    const user = await authenticate(request.cookies.get('ccida_session')?.value);
    const { action, input } = z
      .object({ action: z.string().max(80), input: z.unknown() })
      .parse(await readJson(request));
    if (/^[a-z]+(?:\.[a-z]+)+$/.test(action)) operation = action;
    const actor = {
      ...user,
      ipAddress: request.headers.get('x-real-ip') ?? undefined,
      userAgent: request.headers.get('user-agent') ?? undefined,
    };
    if (action === 'context.resolve')
      return NextResponse.json(await resolveOperatingContext(actor, input), {
        headers: { 'Cache-Control': 'no-store' },
      });
    const handler = ['event.sales.preview', 'event.sales.clear'].includes(action)
      ? eventSalesAction
      : ['shift.close', 'stock.open', 'stock.adjust', 'event.close', 'event.archive'].includes(
            action,
          )
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
    const response = errorResponse(error);
    if (response.status === 409)
      console.warn('Operation conflict:', {
        action: operation,
        status: response.status,
        reason: error instanceof AppError ? error.message : 'Record conflict or record not found.',
      });
    return response;
  }
}
