import { notFound } from 'next/navigation';
import PreviewSandbox from '@/components/madar/PreviewSandbox';

/**
 * Development Preview Route (/preview).
 * Hard-disabled in production via Next.js notFound().
 */
export default function PreviewPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound();
  }

  return <PreviewSandbox />;
}
