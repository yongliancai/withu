// 話題錦囊：不知道說什麼的時候用。
// 問題庫參考 FORD（家庭、工作、休閒、夢想）與 HEFE（嗜好、娛樂、食物、環境），改寫成好回答的小問題。

const ASK_GENERAL = [
  '你今天最累的是哪一刻？', '你最近有在追什麼劇嗎？', '你今天午餐吃什麼？', '你放假最常做什麼？',
  '你最近有沒有想去的地方？', '你小時候想當什麼？', '你是早起派還是晚睡派？', '你最近聽什麼歌？',
  '你最喜歡哪個季節？', '你有沒有一直很想學的東西？', '你心情不好的時候都怎麼辦？', '你喝咖啡還是喝茶？',
  '你最近一次大笑是因為什麼？', '你家附近有什麼好吃的嗎？', '你喜歡貓還是狗？', '如果明天放假你想幹嘛？',
];

// 依職業挑幾題比較具體的
const ASK_JOB = {
  barista_late: ['今天店裡有沒有奇怪的客人？', '你最會做哪一種咖啡？', '拉花最難的是哪一步？'],
  doctor: ['今天值班累不累？', '當醫生最有成就感的是什麼時候？', '你休假都在補眠嗎？'],
  engineer: ['你今天有被 bug 搞嗎？', '你們公司的午餐都吃什麼？', '你下班會打電動嗎？'],
  pastry: ['今天做了什麼甜點？', '你最喜歡的甜點是什麼？', '在台灣最想念日本的什麼？'],
  florist: ['今天店裡最漂亮的是什麼花？', '你最喜歡哪一種花？', '有沒有客人買花的故事很感人？'],
  trainer: ['今天上課的學生有被你操到嗎？', '你自己最喜歡練什麼？', '你有沒有偷吃垃圾食物的時候？'],
  nurse: ['今天班累嗎？', '大夜班的時候都怎麼撐？', '休假最想做什麼？'],
  designer: ['你最近在做什麼設計？', '你覺得台灣哪裡最好拍？', '你最喜歡的顏色是什麼？'],
  ceo: ['你今天開了幾個會？', '你平常怎麼放鬆？', '你最近在煩惱什麼決定？'],
  musician: ['你最近在練哪首歌？', '你第一次上台緊張嗎？', '你最喜歡哪個樂團？'],
  tattoo: ['你今天刺了什麼圖？', '你自己身上的第一個刺青是什麼？', '有沒有客人想刺很奇怪的東西？'],
  student: ['你今天有課嗎？', '你們學校附近有什麼好吃的？', '你報告寫完了嗎？'],
  streamer: ['你今天要開台嗎？', '你最近在玩什麼遊戲？', '聊天室有沒有好笑的留言？'],
  pianist: ['你今天練琴練多久？', '你最喜歡彈哪一首曲子？', '你演出前都會做什麼？'],
};

export const GAMES = [
  { id: 'either', label: '二選一', desc: '他出題，你選一個', reason: '對方想跟你玩「二選一」。出一題輕鬆好玩、跟生活有關的二選一（例如「夏天去海邊還是去山上？」），等對方選完你再說你的答案和理由，然後換對方出題。' },
  { id: 'truth', label: '真心話', desc: '輪流問一個小問題', reason: '對方想跟你玩「真心話」。輪流問對方一個輕鬆、不會太私密的問題，你先回答一題示範，再問對方。依你們的關係階段調整深度。' },
  { id: 'guess', label: '猜猜看', desc: '猜他今天做了什麼', reason: '對方想玩「猜猜看」。出一個關於你今天生活的小謎題（例如「猜我今天午餐吃什麼？給你三個提示」），給第一個提示。' },
  { id: 'story', label: '故事接龍', desc: '一人一句編故事', reason: '對方想玩「故事接龍」。你先起一個有畫面、好接的開頭（一兩句），請對方接下一句。之後每次接一兩句，偶爾來個轉折。' },
];

export const ACTIVITIES = [
  { id: 'watch', label: '一起看劇', invite: '你約{N}一起看劇', desc: '各自看同一部，邊看邊聊', minutes: 120, reason: '對方想跟你「一起看」。問對方想看什麼（劇、電影、YouTube），或推薦一部你最近在看的；開始看之後，像坐在旁邊一樣，偶爾對劇情有反應。' },
  { id: 'focus', label: '陪我專心 25 分鐘', invite: '你請{N}陪你專心 25 分鐘', desc: '他陪你做事，時間到來問進度', minutes: 25, reason: '對方要專心做事 25 分鐘，請你陪著。用一兩句話幫對方打氣，說你也會去做自己的事，然後就安靜等時間到，不要再傳訊息。' },
  { id: 'bedtime', label: '睡前聊聊', invite: '你想聽{N}說睡前故事', desc: '聽他說一個小故事', minutes: 40, reason: '對方準備睡了，想聽你說說話。說一個溫柔的小故事或你今天的一件小事（可以比平常長一點，分成 3–4 則），語氣放慢，最後跟對方說晚安。' },
  { id: 'meal', label: '一起吃飯', invite: '你約{N}一起吃飯', desc: '他陪你想要吃什麼', minutes: 0, reason: '對方想跟你一起吃飯。先問對方現在餓不餓、想吃什麼口味；如果對方不知道，就在 meal 給 2–3 個選項。' },
];

export const LEAD_REASON = '對方不知道要聊什麼，請你帶話題。不要問「你想聊什麼」。挑一個：分享一件你今天具體發生的小事、提起之前你們聊過的事的後續、或丟一個好回答的二選一。輕鬆、好接話。';

export function topicsFor(persona) {
  const P = persona.gender === 'female' ? '她' : '他';
  const fix = (t) => t.replace(/他/g, P);
  const pool = [...(ASK_JOB[persona.job] || []), ...ASK_GENERAL];
  const pick = [];
  const job = ASK_JOB[persona.job] || [];
  if (job.length) pick.push(job[Math.floor(Math.random() * job.length)]);
  while (pick.length < 4) {
    const q = pool[Math.floor(Math.random() * pool.length)];
    if (!pick.includes(q)) pick.push(q);
  }
  return {
    ask: pick,
    games: GAMES.map(({ id, label, desc }) => ({ id, label, desc: fix(desc) })),
    activities: ACTIVITIES.map(({ id, label, desc }) => ({ id, label, desc: fix(desc) })),
  };
}

// 心情按鈕：不想打字時按一下（連按代表越強烈），他會看到並用自己的方式回應。依類別分組；親暱的要關係到了才出現。
export const EMOTION_GROUPS = ['累', '低落', '不安', '生氣', '開心', '想念'];
export const EMOTIONS = [
  { id: 'tired', group: '累', emoji: '😮‍💨', label: '好累' }, { id: 'stress', group: '累', emoji: '😫', label: '壓力好大' },
  { id: 'drained', group: '累', emoji: '🫠', label: '被榨乾了' }, { id: 'sleepy', group: '累', emoji: '😪', label: '好睏' },
  { id: 'sad', group: '低落', emoji: '😢', label: '有點難過' }, { id: 'wronged', group: '低落', emoji: '🥲', label: '好委屈' },
  { id: 'lonely', group: '低落', emoji: '🫥', label: '有點寂寞' }, { id: 'empty', group: '低落', emoji: '😶', label: '空空的' },
  { id: 'lost', group: '低落', emoji: '😵‍💫', label: '好迷惘' }, { id: 'disappointed', group: '低落', emoji: '😞', label: '好失望' },
  { id: 'anxious', group: '不安', emoji: '😰', label: '好焦慮' }, { id: 'nervous', group: '不安', emoji: '😬', label: '好緊張' },
  { id: 'misunderstood', group: '不安', emoji: '😣', label: '被誤會了' },
  { id: 'angry', group: '生氣', emoji: '😤', label: '好生氣' }, { id: 'annoyed', group: '生氣', emoji: '🙄', label: '好煩' },
  { id: 'unfair', group: '生氣', emoji: '😠', label: '覺得不公平' },
  { id: 'happy', group: '開心', emoji: '🥳', label: '好開心' }, { id: 'relieved', group: '開心', emoji: '😌', label: '鬆一口氣' },
  { id: 'proud', group: '開心', emoji: '😎', label: '有成就感' }, { id: 'excited', group: '開心', emoji: '🤩', label: '好期待' },
  { id: 'praise', group: '開心', emoji: '🥹', label: '想被稱讚' }, { id: 'bored', group: '開心', emoji: '🥱', label: '好無聊' },
  // 比較親暱的：關係到了才出現（曖昧、交往）
  { id: 'miss', group: '想念', emoji: '🥺', label: '想你', minStage: 2 }, { id: 'hug', group: '想念', emoji: '🤗', label: '想要抱抱', minStage: 2 },
  { id: 'clingy', group: '想念', emoji: '🥰', label: '想撒嬌', minStage: 3 }, { id: 'see', group: '想念', emoji: '💭', label: '想見你', minStage: 3 },
];

// 「說不出來」引導：先問身體、再問強度和方向、最後給候選的情緒詞（情緒標記／情緒細緻度的鷹架）
export const BODY_FEELINGS = ['胸口悶悶的', '喉嚨緊緊的', '肩膀很重', '胃不舒服', '全身沒力', '心跳很快', '頭很脹', '靜不下來', '想哭'];
export const DIRECTIONS = [{ id: 'hide', label: '想躲起來、什麼都不想做' }, { id: 'act', label: '想做點什麼、想發洩' }, { id: 'none', label: '都不是，就是怪怪的' }];
export function candidateWords(body = [], dir = 'none') {
  const has = (...xs) => xs.some(x => body.includes(x));
  const out = [];
  if (dir === 'hide' && has('胸口悶悶的', '想哭', '喉嚨緊緊的')) out.push('委屈', '失落', '難過', '被忽略');
  if (dir === 'hide' && has('全身沒力', '肩膀很重', '胃不舒服')) out.push('心累', '無力', '空虛', '提不起勁');
  if (dir === 'act' && has('心跳很快', '頭很脹', '靜不下來')) out.push('焦慮', '煩躁', '生氣', '不甘心');
  if (dir === 'act' && has('胸口悶悶的', '喉嚨緊緊的', '想哭')) out.push('生氣', '委屈', '不被理解');
  if (dir === 'act' && has('全身沒力', '肩膀很重', '胃不舒服')) out.push('壓力很大', '煩躁', '想逃');
  if (dir === 'none' || !out.length) out.push('不安', '混亂', '說不上來的累', '有點孤單');
  return [...new Set(out)].slice(0, 6);
}
export function unsureReason({ body, level, dir, word }) {
  const d = DIRECTIONS.find(x => x.id === dir)?.label || '';
  return `對方說不太出自己現在的感覺，用心情按鈕的引導選了：身體的感覺是「${body.join('、')}」，強度 ${level}/5，${d ? `比較「${d}」` : ''}${word ? `，最後覺得最像「${word}」` : '，看了幾個詞都覺得不太像'}。
照你的個性回應，像一個懂得陪伴的人：
1. 先讓對方知道說不出來也沒關係，你有接收到。
2. ${word ? `用對方選的「${word}」` : '從對方的身體感覺出發'}，溫柔地幫對方把感覺說出來，用問句確認，例如「聽起來比較像是有點委屈，不太像生氣，對嗎？」。
3. 最後給一個很好回答的問題（是／不是，或二選一），幫對方再分辨一點點（例如「是跟今天發生的事有關，還是累積很久了？」）。
不要分析、不要診斷、不要說教、不要一次給很多建議，也不要急著讓對方變好。短短的、2–3 則就好。`;
}

export function pokeReason(e, count) {
  const level = count >= 15 ? '非常非常強烈' : count >= 6 ? '很強烈' : '有一點';
  return `對方沒有打字，按了心情按鈕「${e.emoji} ${e.label}」${e.custom ? '（這是對方自己寫的心情）' : ''}${count > 1 ? `，連按了 ${count} 下（${level}）` : ''}。依你的個性和你們的關係回應這個情緒：先回應（壓力、累、難過、生氣就先陪伴、不要說教；無聊就陪玩或丟個好玩的話題；想你、想抱抱就依關係階段回應，還不熟時溫暖但有分寸；開心就一起開心、問發生什麼好事）。短短的、像真人看到朋友傳這個時會回的樣子；可以搭配貼圖。`;
}
