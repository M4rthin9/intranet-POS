import { redirect, notFound } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { pageUser } from '@/lib/page-user';
import { canView, homePath, pathView } from '@/lib/role-pages';

export default async function Page({ params }: { params: Promise<{ screen: string }> }) {
  const view = pathView((await params).screen);
  if (!view) notFound();
  const user = await pageUser();
  if (!user) redirect('/');
  if (!canView(user.roleName, view)) redirect(homePath(user.roleName));
  return <AppShell key={`${user.id}:${view}`} initialUser={user} initialView={view} />;
}
