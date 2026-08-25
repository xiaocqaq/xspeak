/**
 * 主题三态：light / dark / system，默认 system。
 *
 * 深浅由 <html data-appearance="light|dark"> 决定，globals.css 只认这个属性。
 * 单独留 data-theme 记住用户的选择（system 档要能区分"选了跟随"和"选了浅色"）。
 */

export const THEMES = ['light', 'dark', 'system'] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_KEY = 'xlearn-theme';

/** 和 globals.css 里的 --bg 保持一致，用于 <meta name="theme-color">（PWA 状态栏） */
export const THEME_COLORS = { light: '#f6f7f2', dark: '#0f1614' } as const;

export function normalizeTheme(v: unknown): Theme {
  return THEMES.includes(v as Theme) ? (v as Theme) : 'system';
}

/**
 * 首屏防闪脚本。
 *
 * 必须在 <body> 之前同步执行完：否则系统深色的访客会先看到一帧浅色。
 * 因为要内联进 HTML，这里刻意写成 ES5 + 字符串形式，不依赖任何构建产物；
 * 逻辑要和下面的 applyTheme 保持一致，改一处就得改两处。
 */
export const THEME_INIT_SCRIPT = `(function(){try{
var K='${THEME_KEY}',O=['light','dark','system'],C=${JSON.stringify(THEME_COLORS)};
var t=null;try{t=localStorage.getItem(K)}catch(e){}
if(O.indexOf(t)<0)t='system';
var m=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)');
var d=t==='dark'||(t==='system'&&!!(m&&m.matches));
var r=document.documentElement;
r.setAttribute('data-appearance',d?'dark':'light');
r.setAttribute('data-theme',t);
var g=document.querySelector('meta[name="theme-color"]');
if(g)g.setAttribute('content',d?C.dark:C.light);
}catch(e){}})()`;

/** 把选择写进 DOM + localStorage。返回实际生效的深浅。 */
export function applyTheme(theme: Theme): 'light' | 'dark' {
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  const appearance = dark ? 'dark' : 'light';

  const root = document.documentElement;
  root.setAttribute('data-appearance', appearance);
  root.setAttribute('data-theme', theme);

  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', THEME_COLORS[appearance]);

  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // 隐私模式下写不进去，只影响下次进来的默认值，不值得打断用户
  }
  return appearance;
}

export function readTheme(): Theme {
  if (typeof document === 'undefined') return 'system';
  return normalizeTheme(document.documentElement.getAttribute('data-theme'));
}
