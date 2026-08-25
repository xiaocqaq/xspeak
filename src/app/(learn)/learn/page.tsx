import { Suspense } from 'react';
import { SessionRunner } from '@/components/stages/runner';
import { Spinner } from '@/components/ui';

export const metadata = { title: '今日学习' };
export const dynamic = 'force-dynamic';

export default function LearnPage() {
  return (
    <Suspense fallback={<div className="py-20"><Spinner label="准备今天的内容" /></div>}>
      <SessionRunner />
    </Suspense>
  );
}
