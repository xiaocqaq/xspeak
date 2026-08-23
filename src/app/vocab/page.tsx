import { VocabPage } from '@/components/vocab-page';

export const metadata = { title: '词库' };
export const dynamic = 'force-dynamic';

export default function Page() {
  return <VocabPage />;
}
