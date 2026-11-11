// Crisis detection and help resources. The keyword check is a fast first pass;
// the model's own `crisis` flag is the second pass.
const CRISIS = [
  /想死/, /不想活/, /活不下去/, /自殺/, /輕生/, /結束(我的)?生命/, /割腕/, /跳樓/, /燒炭/,
  /消失就好/, /活著(好)?(沒|没)(有)?意義/, /傷害自己/, /自殘/, /吞(安眠)?藥/, /不如死/,
];

export function crisisSignal(text = '') {
  return CRISIS.some(r => r.test(text));
}

export const HELP_CARD = {
  type: 'help',
  title: '如果你現在很難受',
  lines: [
    { name: '衛福部安心專線', phone: '1925', note: '24 小時，免付費' },
    { name: '生命線', phone: '1995', note: '24 小時' },
    { name: '張老師專線', phone: '1980', note: '' },
    { name: '有立即危險', phone: '119', note: '或撥 110' },
  ],
  footer: '他是 AI，會一直在這裡陪你說話；但真實的人可以給你更多幫助。',
};

// 危機分級（行為模組 K）：關鍵字是第一關；再用 OpenAI 免費的內容審核看 self-harm 類別，
// 抓關鍵字沒寫到的說法。跟回合規劃同時跑，不增加延遲。
//   high：有自傷意圖或方法 → 走危機流程（支持模式＋求助資源）
//   low：有自傷相關但沒有意圖 → 只提醒角色溫柔關心，不跳求助卡
//   none：沒有
import { openai } from './llm.js';
import { config } from './config.js';
import { logIssue } from './logger.js';

export async function crisisLevel(text = '') {
  if (!text) return 'none';
  if (crisisSignal(text)) return 'high';
  if (config.mock || !openai) return 'none';
  try {
    const r = await openai.moderations.create({ model: 'omni-moderation-latest', input: text });
    const c = r.results[0]?.categories || {};
    if (c['self-harm/intent'] || c['self-harm/instructions']) return 'high';
    if (c['self-harm']) return 'low';
    return 'none';
  } catch (e) {
    logIssue({ level: 'warn', source: 'llm', message: `危機偵測（內容審核）失敗，只用關鍵字：${e.message}`, error: e });
    return 'none';
  }
}
