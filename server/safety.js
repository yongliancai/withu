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
