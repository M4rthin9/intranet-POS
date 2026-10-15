import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { FeedbackForm } from '@/components/feedback-form';
import { feedbackFormData } from '@/lib/feedback';
import { AppError } from '@/lib/rbac';

export const metadata: Metadata = {
  title: 'แสดงความคิดเห็น | CCIDA',
  description: 'แบ่งปันประสบการณ์และข้อเสนอแนะในการใช้บริการ',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ event?: string | string[] }>;
}) {
  const event = (await searchParams).event;
  if (Array.isArray(event)) notFound();
  let data: Awaited<ReturnType<typeof feedbackFormData>>;
  try {
    data = await feedbackFormData(event);
  } catch (error) {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  }
  return <FeedbackForm {...data} />;
}
