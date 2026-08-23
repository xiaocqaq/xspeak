/**
 * 内置启动词表：A1/A2 高频口语词，按主题分组。
 * 这只是"开机燃料"，日常主题里缺的词由 AI 按你的兴趣现场补充并入库。
 * 紧凑格式：term|phonetic|pos|中文|英文释义|cefr|theme|例句|例句中文
 */
export type SeedWord = {
  term: string;
  phonetic: string;
  pos: string;
  meaning_zh: string;
  meaning_en: string;
  cefr: string;
  theme: string;
  example_en: string;
  example_zh: string;
};

function parse(rows: string[]): SeedWord[] {
  return rows.map((r) => {
    const [term, phonetic, pos, zh, en, cefr, theme, ex, exZh] = r.split('|');
    return {
      term,
      phonetic,
      pos,
      meaning_zh: zh,
      meaning_en: en,
      cefr,
      theme,
      example_en: ex,
      example_zh: exZh,
    };
  });
}

const RAW: string[] = [
  // —— 咖啡店 / 点单 ——
  `order|/ˈɔːrdər/|v./n.|点单；订购|to ask for food or drinks|A1|coffee-shop|Can I order a large latte, please?|我能点一杯大杯拿铁吗？`,
  `refill|/ˈriːfɪl/|n./v.|续杯；再装满|another serving of a drink|A2|coffee-shop|Is a refill free here?|这里续杯免费吗？`,
  `takeaway|/ˈteɪkəweɪ/|n./adj.|外带|food you take with you|A2|coffee-shop|I'd like it takeaway, not for here.|我要外带，不在店里喝。`,
  `receipt|/rɪˈsiːt/|n.|收据|a paper showing what you paid|A2|coffee-shop|Could I have the receipt?|能给我收据吗？`,
  `straw|/strɔː/|n.|吸管|a thin tube for drinking|A1|coffee-shop|Do you need a straw with that?|需要吸管吗？`,
  `beans|/biːnz/|n.|咖啡豆；豆子|coffee seeds|A1|coffee-shop|These beans taste a bit sour.|这些豆子有点酸。`,
  `mild|/maɪld/|adj.|温和的；不浓的|not strong in taste|A2|coffee-shop|I prefer something mild in the morning.|我早上喜欢喝淡一点的。`,
  `queue|/kjuː/|n./v.|排队|a line of people waiting|A2|coffee-shop|The queue moves fast here.|这里队伍走得挺快。`,

  // —— 闲聊 / 天气 ——
  `chilly|/ˈtʃɪli/|adj.|微冷的|slightly cold|A2|small-talk|It's chilly this morning, isn't it?|今天早上有点冷，是吧？`,
  `humid|/ˈhjuːmɪd/|adj.|潮湿的|with a lot of water in the air|A2|small-talk|Summer here is hot and humid.|这里夏天又热又潮。`,
  `forecast|/ˈfɔːrkæst/|n./v.|预报|what the weather will be|A2|small-talk|The forecast says rain tomorrow.|预报说明天下雨。`,
  `weekend|/ˈwiːkend/|n.|周末|Saturday and Sunday|A1|small-talk|Any plans for the weekend?|周末有什么安排吗？`,
  `busy|/ˈbɪzi/|adj.|忙的|having a lot to do|A1|small-talk|I've been pretty busy lately.|我最近挺忙的。`,
  `relax|/rɪˈlæks/|v.|放松|to rest and feel calm|A1|small-talk|I just want to relax at home.|我只想在家放松一下。`,
  `neighbour|/ˈneɪbər/|n.|邻居|a person living next to you|A1|small-talk|My neighbour is really friendly.|我邻居很友善。`,

  // —— 超市 / 购物 ——
  `discount|/ˈdɪskaʊnt/|n.|折扣|money taken off the price|A2|supermarket|Is there a discount on these?|这些有折扣吗？`,
  `expire|/ɪkˈspaɪər/|v.|过期|to come to an end date|A2|supermarket|This milk expires tomorrow.|这牛奶明天过期。`,
  `cash|/kæʃ/|n.|现金|coins and notes|A1|supermarket|Do you take cash only?|你们只收现金吗？`,
  `change|/tʃeɪndʒ/|n./v.|零钱；改变|money returned to you|A1|supermarket|Here's your change.|这是你的零钱。`,
  `aisle|/aɪl/|n.|货架通道|a passage between shelves|A2|supermarket|Bread is in the next aisle.|面包在下一个通道。`,
  `fresh|/freʃ/|adj.|新鲜的|recently made or picked|A1|supermarket|Are these vegetables fresh?|这些蔬菜新鲜吗？`,
  `trolley|/ˈtrɑːli/|n.|购物车|a cart for shopping|A2|supermarket|My trolley is already full.|我的购物车已经满了。`,

  // —— 问路 / 出行 ——
  `straight|/streɪt/|adv.|直地|without turning|A1|directions|Go straight for two blocks.|直走两个街区。`,
  `corner|/ˈkɔːrnər/|n.|拐角|where two streets meet|A1|directions|Turn left at the corner.|在拐角处左转。`,
  `opposite|/ˈɑːpəzɪt/|prep./adj.|对面的|facing something|A2|directions|It's opposite the bank.|它在银行对面。`,
  `nearby|/ˌnɪrˈbaɪ/|adv./adj.|附近|close to here|A2|directions|Is there a pharmacy nearby?|附近有药店吗？`,
  `crossing|/ˈkrɔːsɪŋ/|n.|人行横道|a place to cross a road|A2|directions|Use the crossing over there.|走那边的人行横道。`,
  `lost|/lɔːst/|adj.|迷路的|not knowing where you are|A1|directions|Sorry, I think I'm lost.|抱歉，我好像迷路了。`,

  // —— 餐厅 ——
  `reserve|/rɪˈzɜːrv/|v.|预订|to book in advance|A2|restaurant|I'd like to reserve a table for two.|我想订一张两人桌。`,
  `menu|/ˈmenjuː/|n.|菜单|a list of dishes|A1|restaurant|Could we see the menu, please?|能看一下菜单吗？`,
  `spicy|/ˈspaɪsi/|adj.|辣的|with a hot, strong taste|A1|restaurant|Is this dish very spicy?|这道菜很辣吗？`,
  `allergic|/əˈlɜːrdʒɪk/|adj.|过敏的|reacting badly to something|A2|restaurant|I'm allergic to peanuts.|我对花生过敏。`,
  `bill|/bɪl/|n.|账单|the paper showing what you owe|A1|restaurant|Could we have the bill?|能结账吗？`,
  `tip|/tɪp/|n./v.|小费|extra money for service|A2|restaurant|Should I leave a tip?|需要给小费吗？`,
  `starter|/ˈstɑːrtər/|n.|前菜|the first small dish|A2|restaurant|We'll skip the starter.|我们不要前菜。`,
];

RAW.push(
  // —— 看医生 / 健康 ——
  `symptom|/ˈsɪmptəm/|n.|症状|a sign of illness|A2|doctor|My main symptom is a sore throat.|我主要的症状是喉咙痛。`,
  `sore|/sɔːr/|adj.|疼痛的|painful when touched|A1|doctor|I have a sore throat.|我喉咙痛。`,
  `cough|/kɔːf/|n./v.|咳嗽|to push air out noisily|A1|doctor|I've had a cough for three days.|我咳嗽三天了。`,
  `fever|/ˈfiːvər/|n.|发烧|a high body temperature|A1|doctor|I think I have a fever.|我好像发烧了。`,
  `prescription|/prɪˈskrɪpʃn/|n.|处方|a doctor's note for medicine|A2|doctor|The doctor gave me a prescription.|医生给我开了处方。`,
  `appointment|/əˈpɔɪntmənt/|n.|预约|an arranged meeting time|A2|doctor|I'd like to make an appointment.|我想预约。`,
  `painkiller|/ˈpeɪnkɪlər/|n.|止痛药|medicine that stops pain|A2|doctor|Can I take a painkiller for this?|这个可以吃止痛药吗？`,

  // —— 机场 / 酒店 / 打车 ——
  `boarding|/ˈbɔːrdɪŋ/|n.|登机|getting on a plane|A2|airport|Boarding starts in ten minutes.|十分钟后开始登机。`,
  `luggage|/ˈlʌɡɪdʒ/|n.|行李|bags you travel with|A1|airport|I only have one piece of luggage.|我只有一件行李。`,
  `delay|/dɪˈleɪ/|n./v.|延误|to make something late|A2|airport|My flight was delayed by two hours.|我的航班延误了两小时。`,
  `gate|/ɡeɪt/|n.|登机口|the door to the plane|A1|airport|Which gate is it?|在哪个登机口？`,
  `aisle seat|/aɪl siːt/|n.|靠走道座位|a seat next to the passage|A2|airport|Could I get an aisle seat?|能给我靠走道的座位吗？`,
  `check in|/tʃek ɪn/|v.|办入住/值机|to register on arrival|A1|hotel|I'd like to check in, please.|我想办入住。`,
  `booking|/ˈbʊkɪŋ/|n.|预订|a reservation|A2|hotel|I have a booking under Lin.|我有个姓林的预订。`,
  `towel|/ˈtaʊəl/|n.|毛巾|cloth for drying yourself|A1|hotel|Could I get an extra towel, please?|能再给我一条毛巾吗？`,
  `available|/əˈveɪləbl/|adj.|可用的|free to be used|A2|hotel|Is a quieter room available?|有安静一点的房间吗？`,
  `deposit|/dɪˈpɑːzɪt/|n.|押金|money paid as security|A2|hotel|Do I need to pay a deposit?|需要付押金吗？`,
  `drop off|/drɑːp ɔːf/|v.|放下（人/物）|to leave someone somewhere|A2|taxi|Please drop me off at the corner.|请在拐角放我下车。`,
  `fare|/fer/|n.|车费|money for a ride|A2|taxi|How much is the fare to the airport?|到机场车费多少？`,
  `traffic|/ˈtræfɪk/|n.|交通；车流|cars moving on roads|A1|taxi|The traffic is really bad now.|现在交通很堵。`,

  // —— 社交 / 介绍 / 爱好 ——
  `introduce|/ˌɪntrəˈduːs/|v.|介绍|to tell people who someone is|A1|introduce-self|Let me introduce myself.|我来自我介绍一下。`,
  `originally|/əˈrɪdʒənəli/|adv.|原本；起初|at the beginning|A2|introduce-self|I'm originally from a small town.|我原本来自一个小镇。`,
  `major|/ˈmeɪdʒər/|n./v.|专业|your main subject of study|A2|introduce-self|I majored in computer science.|我专业是计算机。`,
  `hobby|/ˈhɑːbi/|n.|爱好|something you enjoy doing|A1|hobbies|Photography is my main hobby.|摄影是我主要的爱好。`,
  `be into|/bi ˈɪntuː/|phr.|热衷于|to be interested in|A2|hobbies|I'm really into hiking lately.|我最近很喜欢徒步。`,
  `plot|/plɑːt/|n.|情节|the story of a film or book|A2|movies|The plot was easy to follow.|情节挺好懂的。`,
  `boring|/ˈbɔːrɪŋ/|adj.|无聊的|not interesting|A1|movies|The ending was a bit boring.|结尾有点无聊。`,
  `recommend|/ˌrekəˈmend/|v.|推荐|to say something is good|A2|movies|Would you recommend it?|你会推荐它吗？`,
  `lyrics|/ˈlɪrɪks/|n.|歌词|the words of a song|A2|music|I can't catch the lyrics.|我听不清歌词。`,
  `apologize|/əˈpɑːlədʒaɪz/|v.|道歉|to say you are sorry|A2|apologizing|I want to apologize for being late.|我想为迟到道歉。`,
  `on purpose|/ɑːn ˈpɜːrpəs/|phr.|故意地|intentionally|A2|apologizing|I didn't do it on purpose.|我不是故意的。`,

  // —— 工作 ——
  `deadline|/ˈdedlaɪn/|n.|截止日期|the last day to finish|A2|work-intro|The deadline is next Friday.|截止日期是下周五。`,
  `in charge of|/ɪn tʃɑːrdʒ əv/|phr.|负责|responsible for|A2|work-intro|I'm in charge of testing.|我负责测试。`,
  `colleague|/ˈkɑːliːɡ/|n.|同事|a person you work with|A2|work-intro|My colleague will help you.|我同事会帮你。`,
  `agree|/əˈɡriː/|v.|同意|to have the same opinion|A1|meeting|I agree with your point.|我同意你的观点。`,
  `however|/haʊˈevər/|adv.|然而|but; despite that|A2|meeting|However, we need more time.|然而，我们需要更多时间。`,
  `suggest|/səˈdʒest/|v.|建议|to offer an idea|A2|meeting|I'd suggest we start smaller.|我建议我们从小处开始。`,
  `attach|/əˈtætʃ/|v.|附上|to add a file to an email|A2|email|I've attached the report.|我附上了报告。`,
  `confirm|/kənˈfɜːrm/|v.|确认|to say something is certain|A2|email|Please confirm by Friday.|请在周五前确认。`,

  // —— 通用高频 ——
  `actually|/ˈæktʃuəli/|adv.|实际上|in fact|A1|opinions|Actually, I prefer tea.|其实我更喜欢茶。`,
  `maybe|/ˈmeɪbi/|adv.|也许|perhaps|A1|opinions|Maybe we can try later.|也许我们可以晚点试。`,
  `because|/bɪˈkɔːz/|conj.|因为|for the reason that|A1|opinions|I like it because it's simple.|我喜欢它因为它简单。`,
  `enough|/ɪˈnʌf/|adj./adv.|足够的|as much as needed|A1|opinions|That's good enough for me.|对我来说够好了。`,
  `usually|/ˈjuːʒuəli/|adv.|通常|most of the time|A1|hobbies|I usually wake up at seven.|我通常七点起床。`,
  `almost|/ˈɔːlmoʊst/|adv.|几乎|nearly|A1|making-plans|I'm almost ready.|我快好了。`,
  `instead|/ɪnˈsted/|adv.|代替|in place of that|A2|making-plans|Let's meet Sunday instead.|我们改成周日见吧。`,
  `free|/friː/|adj.|有空的|not busy; able to meet|A1|making-plans|Are you free at six?|你六点有空吗？`,
  `mind|/maɪnd/|v.|介意|to feel annoyed by|A2|small-talk|Do you mind if I sit here?|我坐这里你介意吗？`,
  `figure out|/ˈfɪɡjər aʊt/|phr.|弄明白|to understand or solve|A2|tech-help|I can't figure out this error.|我搞不懂这个错误。`,
  `works|/wɜːrks/|v.|运转正常|functions properly|A1|tech-help|It doesn't work anymore.|它现在不能用了。`,
  `restart|/riːˈstɑːrt/|v.|重启|to start again|A1|tech-help|Try to restart your phone.|试试重启手机。`,
);

export const SEED_WORDS: SeedWord[] = parse(RAW);
export const __RAW_WORDS = RAW;
