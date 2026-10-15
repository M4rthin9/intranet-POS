import { AppShell } from '@/components/app-shell';
import { redirect } from 'next/navigation';
import { pageUser } from '@/lib/page-user';
import { homePath } from '@/lib/role-pages';
export default async function Page() {
  const user = await pageUser();
  if (user) redirect(homePath(user.roleName));
  return <AppShell />;
}
