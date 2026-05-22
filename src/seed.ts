// server/src/seed.ts
// Run with: npm run seed
// Seeds the database with the admin user + all events/articles from the static data.

import * as dotenv from 'dotenv';

dotenv.config();

import mongoose from 'mongoose';
import slugify  from 'slugify';
import User     from './models/User';
import Event    from './models/Event';
import Article  from './models/Article';

const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function parseDateParts(isoStr: string) {
  const d = new Date(isoStr);
  return {
    day:   String(d.getDate()).padStart(2, '0'),
    month: MONTHS[d.getMonth()],
    year:  String(d.getFullYear()),
  };
}

function formatDate(isoStr: string): string {
  const d = new Date(isoStr);
  return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

// ── Raw event data (from the static file) ───────────────────────
const EVENTS_DATA = [
  { title:'Summer Open-Mic Night', category:'Music', categoryKey:'music', featured:false, dateISO:'2025-06-07', dateLabel:'Saturday, 7 June 2025', timeStart:'7:00 PM', timeEnd:'10:00 PM', location:'Main Hall, Communitas Centre', address:'12 Heritage Lane, London EC1A 4BT', capacity:120, registered:84, price:'Free', organiser:'Music & Arts Committee', image:'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=1200&q=85', thumbImage:'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=600&q=80', tags:['music','performance','open-mic'], shortDesc:'An evening of original performances from community musicians. Bring your friends, bring your voice.', fullDesc:'<p>Our beloved Open-Mic Night returns for the summer edition — and it promises to be the best one yet.</p>', schedule:[{time:'6:30 PM',item:'Doors open'},{time:'7:00 PM',item:'Welcome & first performers'},{time:'10:00 PM',item:'Close'}], highlights:['Licensed bar from 6:30 PM','8-minute performer slots','All genres welcome','Free audience entry'] },
  { title:'Annual Community Festival 2025', category:'Gathering', categoryKey:'gathering', featured:true, dateISO:'2025-06-14', dateLabel:'Saturday, 14 June 2025', timeStart:'10:00 AM', timeEnd:'9:00 PM', location:'Community Park Grounds', address:'Riverside Park, London EC2A 1AB', capacity:2000, registered:1340, price:'Free', organiser:'Communitas Board', image:'https://images.unsplash.com/photo-1517457373958-b7bdd4587205?w=1200&q=85', thumbImage:'https://images.unsplash.com/photo-1517457373958-b7bdd4587205?w=600&q=80', tags:['festival','culture','family','music','food'], shortDesc:"A full-day celebration of culture, food, sport, and art. Our biggest event of the year!", fullDesc:'<p>The Annual Communitas Festival is the highlight of our calendar.</p>', schedule:[{time:'10:00 AM',item:'Gates open'},{time:'7:00 PM',item:'Headline concert'},{time:'9:00 PM',item:'Close & fireworks'}], highlights:['Free entry all day','Main stage headline concert','Food from 12+ cuisines','Fireworks finale'] },
  { title:'Community Cricket Tournament', category:'Sports', categoryKey:'sports', featured:false, dateISO:'2025-06-21', dateLabel:'Saturday, 21 June 2025', timeStart:'9:00 AM', timeEnd:'5:00 PM', location:'Sports Ground, East Side', address:'East Road Sports Ground, London E1 6RF', capacity:300, registered:156, price:'£5 per player', organiser:'Sports Committee', image:'https://images.unsplash.com/photo-1547919307-1ecb10702e6f?w=1200&q=85', thumbImage:'https://images.unsplash.com/photo-1547919307-1ecb10702e6f?w=600&q=80', tags:['cricket','sports','tournament'], shortDesc:'Six teams, one trophy. Register your team and compete in a friendly but fierce neighbourhood championship.', fullDesc:'<p>The annual Community Cricket Tournament is back.</p>', schedule:[{time:'9:00 AM',item:'Matches begin'},{time:'3:30 PM',item:'Final'},{time:'5:00 PM',item:'BBQ & prize-giving'}], highlights:['6 team slots','10-over format','£5 per player','Post-match BBQ'] },
  { title:'Mural Painting Workshop', category:'Arts', categoryKey:'arts', featured:false, dateISO:'2025-07-05', dateLabel:'Saturday, 5 July 2025', timeStart:'11:00 AM', timeEnd:'4:00 PM', location:'East Wall, Communitas Centre', address:'12 Heritage Lane, London EC1A 4BT', capacity:40, registered:27, price:'Free', organiser:'Arts & Culture Committee', image:'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=1200&q=85', thumbImage:'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=600&q=80', tags:['arts','painting','mural','workshop'], shortDesc:"Help paint the new public mural on the community centre's east wall. All skill levels welcome.", fullDesc:'<p>Phase two of our public mural project is underway.</p>', schedule:[{time:'11:00 AM',item:'Introduction'},{time:'11:30 AM',item:'Painting begins'},{time:'4:00 PM',item:'Close'}], highlights:['All skill levels welcome','Lunch included','Wheelchair accessible'] },
  { title:'Cultural Dance Showcase', category:'Dance', categoryKey:'dance', featured:false, dateISO:'2025-07-19', dateLabel:'Saturday, 19 July 2025', timeStart:'6:00 PM', timeEnd:'9:00 PM', location:'Auditorium, Level 2', address:'12 Heritage Lane, London EC1A 4BT', capacity:180, registered:92, price:'£5 / Free for under-16s', organiser:'Dance Academy', image:'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=1200&q=85', thumbImage:'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=600&q=80', tags:['dance','performance','culture'], shortDesc:'Students from our dance academy present their seasonal showcase across five cultural traditions.', fullDesc:'<p>The seasonal showcase spans five cultural dance traditions.</p>', schedule:[{time:'6:00 PM',item:'First half'},{time:'7:15 PM',item:'Interval'},{time:'9:00 PM',item:'Close'}], highlights:['63 performers','5 cultural traditions','Free for under-16s'] },
  { title:'Seniors Digital Literacy Drop-In', category:'Seniors', categoryKey:'seniors', featured:false, dateISO:'2025-07-26', dateLabel:'Saturday, 26 July 2025', timeStart:'10:00 AM', timeEnd:'1:00 PM', location:'Digital Suite, Ground Floor', address:'12 Heritage Lane, London EC1A 4BT', capacity:24, registered:11, price:'Free', organiser:'Seniors Wellbeing Team', image:'https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?w=1200&q=85', thumbImage:'https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?w=600&q=80', tags:['seniors','digital','technology'], shortDesc:'Monthly drop-in for seniors wanting help with phones, tablets, and computers. No question too basic.', fullDesc:'<p>Our monthly Digital Drop-In is a relaxed, pressure-free session.</p>', schedule:[{time:'10:00 AM',item:'Drop-in opens'},{time:'1:00 PM',item:'Close'}], highlights:['No appointment needed','One-to-one help','Tea & biscuits'] },
  { title:'Charity 5K Fun Run', category:'Sports', categoryKey:'sports', featured:false, dateISO:'2025-09-20', dateLabel:'Saturday, 20 September 2025', timeStart:'9:00 AM', timeEnd:'12:00 PM', location:'Riverside Park — starting line at the bandstand', address:'Riverside Park, London EC2A 1AB', capacity:250, registered:88, price:'£8 registration + fundraising', organiser:'Sports Committee', image:'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=1200&q=85', thumbImage:'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=600&q=80', tags:['running','charity','sports','fitness'], shortDesc:'A scenic 5K through Riverside Park raising money for the new outdoor sports area.', fullDesc:'<p>Lace up and join us for the Communitas Charity 5K.</p>', schedule:[{time:'9:00 AM',item:'Start'},{time:'11:00 AM',item:'Prize-giving'},{time:'12:00 PM',item:'Close'}], highlights:['Walkers welcome','Post-run breakfast','Fundraising for sports area'] },
  { title:'Spring Fitness Bootcamp', category:'Sports', categoryKey:'sports', featured:false, dateISO:'2025-04-05', dateLabel:'Saturday, 5 April 2025', timeStart:'8:00 AM', timeEnd:'10:00 AM', location:'Sports Ground, East Side', address:'East Road Sports Ground, London E1 6RF', capacity:60, registered:58, price:'Free', organiser:'Sports Committee', image:'https://images.unsplash.com/photo-1547919307-1ecb10702e6f?w=1200&q=85', thumbImage:'https://images.unsplash.com/photo-1547919307-1ecb10702e6f?w=600&q=80', tags:['fitness','sports','outdoor'], shortDesc:'A high-energy outdoor fitness session to kick off the spring season.', fullDesc:'<p>Our spring bootcamp welcomed 58 participants.</p>', schedule:[], highlights:['58 participants','All fitness levels','Free'] },
];

// ── Raw article data ─────────────────────────────────────────────
const ARTICLES_DATA = [
  { title:'How Our Neighbourhood Came Together After the Storm', category:'Community', categoryKey:'community', dateISO:'2025-05-28', author:'Sarah Okafor', authorRole:'Community Reporter', authorAvatar:'https://randomuser.me/api/portraits/women/44.jpg', readTime:'8 min read', featured:true, tags:['community','resilience','volunteering'], excerpt:"When last autumn's floods hit hardest, it was our community network that mobilised first.", image:'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=1200&q=85', content:'<p class="article-lead">When the floodwaters rose last October, the official response took nearly 48 hours to arrive. But Communitas volunteers were already on the streets within two hours.</p><h2>The First 48 Hours</h2><p>Team leader Marcus Webb recalls the moment he realised the scale of what was unfolding.</p>', published:true },
  { title:'Youth Leaders Programme Graduates Its Tenth Cohort', category:'Youth', categoryKey:'youth', dateISO:'2025-05-14', author:'James Holloway', authorRole:'Youth Programme Lead', authorAvatar:'https://randomuser.me/api/portraits/men/58.jpg', readTime:'5 min read', featured:false, tags:['youth','leadership','education'], excerpt:'Sixteen young people aged 16–21 completed a six-month intensive leadership curriculum.', image:'https://images.unsplash.com/photo-1544717305-2782549b5136?w=1200&q=85', content:'<p class="article-lead">Sixteen young people stood on a stage last Saturday morning and accepted their Youth Leaders certificates.</p><h2>Ten Years of Graduates</h2><p>Since its founding in 2015, the programme has graduated 148 young people.</p>', published:true },
  { title:'Five Traditions, One Stage: Recapping the Spring Festival', category:'Culture', categoryKey:'culture', dateISO:'2025-04-30', author:'Elena Torres', authorRole:'Arts & Culture Writer', authorAvatar:'https://randomuser.me/api/portraits/women/28.jpg', readTime:'4 min read', featured:false, tags:['culture','festival','arts','music'], excerpt:'Over 800 people attended our spring cultural festival, where performers from five distinct cultural traditions shared a single stage.', image:'https://images.unsplash.com/photo-1511795409834-ef04bbd61622?w=1200&q=85', content:'<p class="article-lead">The lights dimmed in the main hall at exactly seven o\'clock.</p><h2>The Performances</h2><p>The evening opened with a classical Bharatanatyam dance piece.</p>', published:true },
  { title:'Why Our Free Sports Programme Has a 95% Retention Rate', category:'Sports', categoryKey:'sports', dateISO:'2025-04-12', author:'Ravi Sharma', authorRole:'Sports Coordinator', authorAvatar:'https://randomuser.me/api/portraits/men/32.jpg', readTime:'3 min read', featured:false, tags:['sports','health','community'], excerpt:'Most community sports programmes see drop-off rates of 40–60%. Ours retains 95% of participants year on year.', image:'https://images.unsplash.com/photo-1547919307-1ecb10702e6f?w=1200&q=85', content:'<p class="article-lead">The national average retention rate for community sports programmes is around 55–60% after the first year. Ours is 95%.</p>', published:true },
  { title:'The Seniors Digital Literacy Programme That\'s Transforming Lives', category:'Seniors', categoryKey:'seniors', dateISO:'2025-03-25', author:'Aisha Malik', authorRole:'Volunteer Coordinator', authorAvatar:'https://randomuser.me/api/portraits/women/44.jpg', readTime:'6 min read', featured:false, tags:['seniors','technology','education'], excerpt:'Twelve months ago, Gerald had never sent an email. Today he runs a WhatsApp group of 40 friends.', image:'https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?w=1200&q=85', content:'<p class="article-lead">Gerald Whitmore is 73 years old. Twelve months ago, he had never sent an email.</p>', published:true },
];

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI as string);
  console.log('✅ Connected to MongoDB');

  // Clear existing data
  await Promise.all([
    User.deleteMany({}),
    Event.deleteMany({}),
    Article.deleteMany({}),
  ]);
  console.log('🗑  Cleared existing data');

  // Create admin user
  await User.create({
    name:     'Admin',
    email:    process.env.ADMIN_EMAIL    || 'admin@communitas.org',
    password: process.env.ADMIN_PASSWORD || 'ChangeMe123!',
    role:     'admin',
  });
  console.log('👤 Admin user created');

  // Seed events
  for (const ev of EVENTS_DATA) {
    const { day, month, year } = parseDateParts(ev.dateISO);
    const today = new Date().toISOString().split('T')[0];
    await Event.create({
      ...ev,
      day, month, year,
      slug: slugify(ev.title, { lower: true, strict: true }),
      status: ev.dateISO < today ? 'past' : 'upcoming',
    });
  }
  console.log(`📅 ${EVENTS_DATA.length} events seeded`);

  // Seed articles
  for (const art of ARTICLES_DATA) {
    await Article.create({
      ...art,
      slug: slugify(art.title, { lower: true, strict: true }),
      date: formatDate(art.dateISO),
    });
  }
  console.log(`📰 ${ARTICLES_DATA.length} articles seeded`);

  console.log('\n✨ Database seeded successfully!\n');
  await mongoose.disconnect();
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});