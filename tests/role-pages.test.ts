import { describe, it, expect, afterAll } from 'vitest';
import { db } from '../src/lib/db';
import { salesFixture } from './sales-helpers';
import { dashboard, report } from '../src/lib/reports';
import { can } from '../src/lib/rbac';
import { rolePages, homePath, canView, pathView, viewPaths } from '../src/lib/role-pages';
import { registrationAction } from '../src/lib/registration';
import { resolveOperatingContext } from '../src/lib/operating-context';
afterAll(() => db.$disconnect());

describe('separate role work pages', () => {
  it('limits the product tag menu and route to Super Admin', () => {
    expect(viewPaths.productTags).toBe('/product-tags');
    expect(pathView('product-tags')).toBe('productTags');
    expect(canView('SUPER_ADMIN', 'productTags')).toBe(true);
    for (const role of ['ADMIN', 'CASHIER', 'REGISTRATION_CASHIER', 'PAYMENT_CASHIER'] as const)
      expect(canView(role, 'productTags')).toBe(false);
  });

  it('restricts cashier routes and authorizes registration without sale or payment privileges', async () => {
    expect(homePath('SUPER_ADMIN')).toBe('/dashboard');
    expect(homePath('ADMIN')).toBe('/dashboard');
    expect(homePath('REGISTRATION_CASHIER')).toBe('/register');
    expect(rolePages.CASHIER.views).toEqual(['pos']);
    expect(rolePages.REGISTRATION_CASHIER.views).toEqual(['registrations']);
    expect(rolePages.PAYMENT_CASHIER.views).toEqual(['payments']);
    expect(canView('CASHIER', 'dashboard')).toBe(false);
    expect(canView('REGISTRATION_CASHIER', 'dashboard')).toBe(false);
    expect(canView('REGISTRATION_CASHIER', 'pos')).toBe(false);
    expect(can('REGISTRATION_CASHIER', 'registration.create')).toBe(true);
    expect(can('REGISTRATION_CASHIER', 'order.create')).toBe(false);
    expect(can('REGISTRATION_CASHIER', 'payment.confirm')).toBe(false);
    const f = await salesFixture();
    const context = await resolveOperatingContext(f.actors.REGISTRATION_CASHIER, {
      eventId: f.event.id,
    });
    const customer = await registrationAction(
      f.actors.REGISTRATION_CASHIER,
      'registration.create',
      {
        eventId: f.event.id,
        stationId: context.station.id,
        customerName: 'Registration cashier permissions',
      },
    );
    expect(customer).toHaveProperty('token');
  });

  it('allows Admin aggregate dashboards without granting detailed reports or exposing customer debt rows', async () => {
    const f = await salesFixture();
    const result = await dashboard(f.actors.ADMIN, f.event.id);
    expect(result.registered).toBe(1);
    expect(result.reconciled).toBe(true);
    expect(result).not.toHaveProperty('outstanding');
    expect(result).not.toHaveProperty('byStation');
    await expect(report(f.actors.ADMIN, f.event.id)).rejects.toThrow('not authorized');
    for (const role of ['CASHIER', 'REGISTRATION_CASHIER', 'PAYMENT_CASHIER'] as const)
      await expect(dashboard(f.actors[role], f.event.id)).rejects.toThrow('not authorized');
  });
});
