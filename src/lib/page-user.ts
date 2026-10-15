import { cookies } from 'next/headers';
import { authenticate } from './auth';
import { AppError } from './rbac';

export async function pageUser() {
  const token = (await cookies()).get('ccida_session')?.value;
  if (!token) return null;
  try {
    return await authenticate(token);
  } catch (error) {
    if (error instanceof AppError && error.status === 401) return null;
    throw error;
  }
}
