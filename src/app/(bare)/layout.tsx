/**
 * 引导流程：不要任何 chrome。
 *
 * 还没建档就没有"导航去别处"这回事，顶栏和侧栏只会分散注意力，
 * 也会让人以为可以跳过。页面自己排版和居中。
 */
export default function BareLayout({ children }: { children: React.ReactNode }) {
  return <main className="min-h-dvh">{children}</main>;
}
