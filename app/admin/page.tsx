import type { Metadata } from 'next';
import AdminConsole from '@/components/madar/AdminConsole';

export const metadata: Metadata = {
  title: 'مدار | مدیریت',
  robots: {
    index: false,
    follow: false,
  },
};

export default function AdminPage() {
  return <AdminConsole />;
}
