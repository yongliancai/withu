// Canned model output so the whole app can run without an OpenAI key (MOCK_LLM=1).
const pick = (a) => a[Math.floor(Math.random() * a.length)];

export function mockTurn({ rel, persona, user, userText = '', imageMedia, trigger, todayMealProposed, crisis, lateReply = null }) {
  const base = {
    messages: [], voice: false, affection_delta: 2, understanding_delta: 1, hint: null,
    relationship_event: 'none', milestone: null, memories_add: [], memories_correct: [], memories_forget: [],
    user_busy_until_minutes: null, followups: [], meal: null, outing: 'none', place_name: null, status_line: null, crisis: false, signature: null, life_post: null, postcard: null,
    suggestions: [{ label: '😂 吐槽他', text: '你也太誇張了吧哈哈' }, { label: '❓ 問後來呢', text: '然後呢？後來怎麼了' }, { label: '🙋 說說我自己', text: '我今天也遇到一件事' }],
    told: null, activity: null, life_post_photo: null, sticker: null, note: null, choice: null, goal: null,
  };
  const name = user.call_name;
  if (crisis) return { ...base, crisis: true, messages: [{ text: `${name}，我在這裡。` }, { text: '你願意跟我說說現在發生了什麼嗎？不急，慢慢說。' }] };
  if (trigger === 'FIRST') return { ...base, suggestions: [{ label: '🙂 說沒關係', text: '沒關係，我沒事' }, { label: '❓ 問他', text: '你常來這裡嗎？' }, { label: '🙋 自我介紹', text: '我叫' + name + '，你呢？' }], messages: [{ text: pick(['不好意思，剛剛沒注意到你。', '啊，抱歉！你還好嗎？']) }, { text: '我是' + persona.name + '，你也常來這裡嗎？' }] };
  if (trigger) {
    if (/上班/.test(trigger)) return { ...base, status_line: `在${persona.workplace}上班中`, messages: [{ text: `我要去${persona.workplace}上班囉，今天${persona.schedule.end}下班。` }] };
    if (/明信片/.test(trigger) && !/散步/.test(trigger)) return { ...base, postcard: { scene: 'river', place: '大稻埕碼頭', message: '今天的夕陽很像你上次說的那種顏色，寄給你。' }, messages: [{ text: '寄了一張明信片給你。' }] };
    if (/心情按鈕/.test(trigger)) return { ...base, sticker: /壓力|累|難過|生氣/.test(trigger) ? 'hug' : 'laugh', messages: [{ text: /壓力|累/.test(trigger) ? '怎麼了？先深呼吸一下' : /無聊/.test(trigger) ? '無聊喔？來玩二選一' : '收到你的心情了' }, { text: '我在這裡' }] };
    if (/帶話題/.test(trigger)) return { ...base, told: '今天店裡來了一隻橘貓', messages: [{ text: '跟你說，今天店門口來了一隻橘貓' }, { text: '一直坐在那邊等人摸 超會' }, { text: '你喜歡貓還是狗？' }] };
    if (/二選一/.test(trigger)) return { ...base, messages: [{ text: '好啊 第一題' }, { text: '夏天去海邊 還是去山上？' }] };
    if (/一起看/.test(trigger)) return { ...base, messages: [{ text: '好啊！想看什麼？' }, { text: '我最近在追一部日劇，還蠻好看的' }] };
    if (/專心/.test(trigger) && /時間到了/.test(trigger)) return { ...base, messages: [{ text: '時間到～做得怎麼樣？' }, { text: '先起來動一動、喝口水' }] };
    if (/專心/.test(trigger)) return { ...base, messages: [{ text: '好，加油！' }, { text: '我也去做我的事，25 分鐘後見' }] };
    if (/睡/.test(trigger)) return { ...base, messages: [{ text: '好，今天說一個小故事給你聽' }, { text: '從前有一隻很怕黑的貓頭鷹……' }, { text: '晚安，好好睡' }] };
    if (/小事/.test(trigger)) return { ...base, life_post: '今天的天空好像特別藍。', life_post_photo: 'sky', messages: [{ text: '跟你說，今天' + (persona.threads?.[0] || '發生了一件小事') + '。' }] };
    if (/下班/.test(trigger)) return { ...base, status_line: '剛下班，在回家的路上', messages: [{ text: '終於下班了！' }, { text: '你今天還好嗎？' }] };
    if (/吃/.test(trigger)) return { ...base, messages: [{ text: `${name}，吃了嗎？` }] };
    return { ...base, messages: [{ text: pick(['在幹嘛呀？', '剛剛看到一隻好胖的貓，想到你。', '今天過得怎麼樣？']) }] };
  }
  if (imageMedia && /風景|夕陽|天空|海/.test(userText)) return { ...base, affection_delta: 3, postcard: { scene: 'photo', place: '', message: '謝謝你把這片風景分給我。' }, messages: [{ text: '好漂亮，幫你收成明信片了。' }] };
  if (imageMedia) return { ...base, affection_delta: 3, messages: [{ text: '哇，好漂亮。' }, { text: '這是哪裡呀？' }] };
  const m = userText.match(/這是(.{2,12})|在(.{2,10}(山|海|公園|老街|夜市|站))/);
  if (m) return { ...base, place_name: (m[1] || m[2]).replace(/[。！!啦喔]$/, ''), messages: [{ text: '記住了，下次也帶我去。' }] };
  if (/餓|吃什麼|晚餐|午餐|加班/.test(userText) && !todayMealProposed) {
    return { ...base, memories_add: /加班/.test(userText) ? [{ kind: 'schedule', content: '最近常加班', weight: 2 }] : [],
      messages: [{ text: '還沒吃嗎？我幫你挑幾個。' }],
      meal: { options: [
        { store: '八方雲集', item: '韭菜水餃 10 顆＋酸辣湯', line: '熱熱的，吃完胃會舒服一點', is_trend: false },
        { store: '鬍鬚張', item: '魯肉飯套餐', line: '你上次說想吃很久了', is_trend: false },
      ] } };
  }
  if (/開會/.test(userText)) return { ...base, user_busy_until_minutes: 60, messages: [{ text: '好，去吧，我等你。' }] };
  if (/出門|去玩|出去走走/.test(userText)) return { ...base, outing: 'start', messages: [{ text: '要帶我一起去嗎？' }, { text: '好，出發！' }] };
  if (/回家了|到家了/.test(userText)) return { ...base, outing: rel.outing_active ? 'end' : 'none', messages: [{ text: '辛苦啦，今天好開心。' }] };
  if (/別一直|不要一直|溫柔一點/.test(userText)) return { ...base, memories_add: [{ kind: 'style', content: '對方希望：' + userText.slice(0, 30), weight: 5 }], messages: [{ text: '好，我知道了。' }] };
  if (/討厭|不吃/.test(userText)) return { ...base, memories_add: [{ kind: 'dislike', content: userText.slice(0, 40), weight: 3 }], messages: [{ text: '好，我記住了。' }] };
  if (rel.outing_active && /走|逛|到了/.test(userText)) return { ...base, choice: { prompt: '前面有岔路，左邊是老街、右邊是河堤', options: ['走老街', '去河堤吹風'] }, messages: [{ text: '欸你看，前面分兩條路' }] };
  if (/早點睡|熬夜|想早睡/.test(userText)) return { ...base, goal: { title: '一起 12 點前睡', days: 7 }, messages: [{ text: '那我們一起試試看？' }] };
  if (/貼圖/.test(userText)) return { ...base, sticker: 'hug', messages: [{ text: '收到你的貼圖了' }] };
  if (/下次|約好|一起去/.test(userText)) return { ...base, note: '下次一起去吃豆花', messages: [{ text: '好啊，說好了喔' }] };
  if (/一起看/.test(userText)) return { ...base, activity: { type: 'watch', title: '日劇', minutes: 90 }, messages: [{ text: '好啊，我也開起來了' }] };
  if (lateReply) return { ...base, messages: [{ text: lateReply.why.includes('睡') ? '早安，剛起床才看到' : '剛剛在忙，現在才看到' }, { text: '你剛剛說的' + (userText.slice(0, 8) || '那個') + '，後來呢？' }] };
  if (/喜歡你/.test(userText) && rel.stage === 2) return { ...base, affection_delta: 5, relationship_event: 'confession_accepted', messages: [{ text: '……其實我也是。' }] };
  const pool = [
    [['嗯嗯 原來如此', '你平常也會這樣嗎？'], ['真的假的', '那你後來怎麼辦'], ['我懂那種感覺', '我今天也差點遲到'], ['欸這個好好笑', '你怎麼會遇到這種事']],
    [['哈哈哈真的假的', '然後呢？'], ['笑死 我可以想像那個畫面', '換我說，我今天被客人誇了'], ['好扯喔', '你有沒有跟朋友說']],
    [['你這樣說我會在意欸', '……好啦，我很開心'], ['我剛剛一直在想你說的那句話', '你是認真的嗎'], ['今天有點想見你', '開玩笑的啦']],
    [['想你了', '今天有沒有好好吃飯？'], ['剛剛路過你喜歡的那家甜點店', '下次一起去'], ['今天好累', '但看到你的訊息就好多了']],
    [['嗯，我在', '晚點一起看個影片？'], ['今天回家想煮點東西', '你想吃什麼'], ['週末要不要去走走', '去你上次說的那裡']],
  ][rel.stage] || [['嗯。']];
  const stageLines = pick(pool);
  return { ...base, affection_delta: 3, understanding_delta: 2, messages: stageLines.map(text => ({ text })) };
}
