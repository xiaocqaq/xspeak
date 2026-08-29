/**
 * 探针：让现有的 StepFun TTS 读一段英文，存成 mp3 给人听。
 *
 * 为什么要有这个：逐句朗读现在走浏览器自带语音包，iOS 上音质不好。
 * 换成服务端 TTS 之前必须先确认一件事 —— StepFun 那 25 个音色是中文人设，
 * 读英文是什么口音无人测过。scripts/score-voices.mjs 量的是词错率，
 * 那个指标已知没用（上游 ASR 认自己的 TTS 认得太准，24/25 都是 0.0%），
 * 口音只能靠耳朵。所以这里不打分，只出音频文件。
 *
 * 用法：node scripts/probe-en-tts.mjs [输出目录]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { voiceConfig } from '../src/lib/voice/config.mjs';
import { AI_VOICES } from '../src/lib/voice-options.mjs';

const OUT = process.argv[2] ?? '/tmp/en-tts';

// 三段各有侧重：单词、例句、听力对白。
// 挑的都是中式口音容易露馅的音 —— th、v/w、词尾辅音、弱读。
const TEXTS = [
  ['word', 'thorough'],
  ['sentence', "She thought the weather would improve, but it's still very windy."],
  ['dialogue', "Would you mind if I opened the window? It's a little warm in here."],
];

// 全测 25 个太多，各取几个有代表性的（含默认音色）。
const PICK = ['elegantgentle-female', 'zhixingjiejie', 'wenrounvsheng', 'qinqienansheng', 'chunzhenxuedi'];

const cfg = voiceConfig();
if (!cfg.apiKey) {
  console.error('没有 key，配 VOICE_API_KEY 或 STEP_API_KEY');
  process.exit(1);
}

const ids = new Set(AI_VOICES.map((v) => v.id));
const voices = PICK.filter((id) => ids.has(id));
const missing = PICK.filter((id) => !ids.has(id));
if (missing.length) console.warn('清单里没有这些音色，跳过：', missing.join(', '));

await mkdir(OUT, { recursive: true });

for (const voice of voices) {
  for (const [tag, text] of TEXTS) {
    const started = Date.now();
    let res;
    try {
      res = await fetch(cfg.ttsUrl, {
        method: 'POST',
        headers: { authorization: `Bearer ${cfg.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: cfg.ttsModel,
          input: text,
          voice,
          response_format: 'mp3',
          speed: 1,
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      console.log(`${voice}/${tag}: 请求失败 ${err.message}`);
      continue;
    }
    if (!res.ok) {
      console.log(`${voice}/${tag}: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const file = `${OUT}/${voice}-${tag}.mp3`;
    await writeFile(file, buf);
    console.log(`${voice}/${tag}: ${buf.length}B ${Date.now() - started}ms -> ${file}`);
  }
}
