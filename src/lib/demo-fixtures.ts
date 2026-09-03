// Seed data for demo mode. Everything lives in memory; nothing hits Supabase.
// The story arc: Sofia is the primary caregiver for her mom Elena (76, T2D +
// hypertension + recent MCI diagnosis). She coordinates with her brother
// Marcus (Portland) and sister Priya (visits monthly). The fixture is tuned
// so HeadsUp fires 3 cards on first load: refill soon, possible side effect,
// pending handoff — telling the "share the load" + "peace of mind" story.

// Deterministic ID prefix helps debugging in the mock query builder.
export const DEMO_FAMILY_ID = 'demo-fam-1';
export const DEMO_PARENT_ID = 'demo-parent-1';
export const DEMO_USER_ID = 'demo-user-1';

const SOFIA_ID = 'demo-mem-sofia';
const MARCUS_ID = 'demo-mem-marcus';
const PRIYA_ID = 'demo-mem-priya';

const MED_METFORMIN = 'demo-med-metformin';
const MED_LISINOPRIL = 'demo-med-lisinopril';
const MED_DONEPEZIL = 'demo-med-donepezil';
const MED_VITD = 'demo-med-vitd';

const APPT_PAST = 'demo-appt-past';
const APPT_UPCOMING = 'demo-appt-upcoming';

// ---- helpers ---------------------------------------------------------------

let counter = 0;
function nextId(prefix: string) {
  counter += 1;
  return `${prefix}-${counter.toString(36).padStart(4, '0')}`;
}

function daysAgo(n: number, hours = 0, minutes = 0) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
}

function daysFromNow(n: number, hours = 9, minutes = 0) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
}

function dateOnly(iso: string) {
  return iso.slice(0, 10);
}

function pickCaregiver(dayOffset: number, slotIndex: number) {
  // Weekdays lean Sofia; weekends lean Marcus; Priya spot-checks.
  const dow = (new Date(daysAgo(dayOffset)).getDay() + 7) % 7;
  const isWeekend = dow === 0 || dow === 6;
  if (isWeekend) {
    return slotIndex % 2 === 0 ? MARCUS_ID : SOFIA_ID;
  }
  if (dayOffset % 9 === 3) return PRIYA_ID; // occasional Priya coverage
  return slotIndex % 3 === 0 ? MARCUS_ID : SOFIA_ID;
}

// ---- seed data (rebuilt on every demo start) --------------------------------

export type TableName =
  | 'families'
  | 'family_members'
  | 'parents'
  | 'medications'
  | 'med_doses'
  | 'appointments'
  | 'visit_notes'
  | 'symptoms'
  | 'handoffs'
  | 'on_duty'
  | 'thread_messages'
  | 'notes';

export type DemoStore = Record<TableName, Record<string, unknown>[]>;

export function buildDemoStore(): DemoStore {
  counter = 0;

  const families = [
    { id: DEMO_FAMILY_ID, name: 'Smith family', created_at: daysAgo(200) },
  ];

  const family_members = [
    {
      id: SOFIA_ID,
      family_id: DEMO_FAMILY_ID,
      user_id: DEMO_USER_ID,
      name: 'Sofia Smith',
      relation: 'Daughter',
      phone: '(916) 555-0104',
      color: 'terracotta',
      photo_url: null,
      is_owner: true,
      created_at: daysAgo(200),
    },
    {
      id: MARCUS_ID,
      family_id: DEMO_FAMILY_ID,
      user_id: 'demo-user-marcus',
      name: 'Marcus Smith',
      relation: 'Son',
      phone: '(503) 555-0187',
      color: 'sage',
      photo_url: null,
      is_owner: false,
      created_at: daysAgo(180),
    },
    {
      id: PRIYA_ID,
      family_id: DEMO_FAMILY_ID,
      user_id: 'demo-user-priya',
      name: 'Priya Smith',
      relation: 'Daughter',
      phone: '(415) 555-0122',
      color: 'butter',
      photo_url: null,
      is_owner: false,
      created_at: daysAgo(160),
    },
  ];

  const parents = [
    {
      id: DEMO_PARENT_ID,
      family_id: DEMO_FAMILY_ID,
      name: 'Elena Smith',
      nickname: 'Mom',
      photo_url: null,
      dob: '1950-03-14',
      conditions: [
        'Type 2 diabetes (12 yr)',
        'Hypertension',
        'Mild cognitive impairment (dx Apr 2026)',
      ],
      allergies: ['Penicillin', 'Sulfa drugs'],
      preferences:
        'Prefers morning appointments. Reads better with large print. Loves gardenia tea.',
      blood_type: 'O+',
      ice_contacts: [
        { name: 'Sofia Smith', relation: 'Daughter', phone: '(916) 555-0104' },
        { name: 'Marcus Smith', relation: 'Son', phone: '(503) 555-0187' },
      ],
      pharmacy: {
        name: 'Walgreens Land Park',
        phone: '(916) 555-0188',
        address: '3050 Freeport Blvd, Sacramento CA',
      },
      primary_doctor: { name: 'Dr. Rachel Nguyen', phone: '(916) 555-0142' },
      insurance: {
        provider: 'Kaiser Permanente',
        memberId: 'KP-EE-7729440',
        groupId: 'G-40182',
        planName: 'Senior Advantage HMO',
        phone: '(800) 464-4000',
      },
      created_at: daysAgo(200),
      updated_at: daysAgo(3),
    },
  ];

  const medications = [
    {
      id: MED_METFORMIN,
      parent_id: DEMO_PARENT_ID,
      family_id: DEMO_FAMILY_ID,
      name: 'Metformin',
      dose: '500 mg tablet',
      purpose: 'Blood sugar (Type 2 diabetes)',
      schedule: [
        { time: '08:00', withFood: true },
        { time: '20:00', withFood: true },
      ],
      prescriber: 'Dr. Nguyen',
      pharmacy: 'Walgreens Land Park',
      refill_by: dateOnly(daysFromNow(45)),
      pills_left: 42,
      notes: 'Take with breakfast and dinner to reduce GI upset.',
      started_at: dateOnly(daysAgo(90)),
      created_at: daysAgo(90),
    },
    {
      id: MED_LISINOPRIL,
      parent_id: DEMO_PARENT_ID,
      family_id: DEMO_FAMILY_ID,
      name: 'Lisinopril',
      dose: '10 mg tablet',
      purpose: 'Blood pressure',
      schedule: [{ time: '08:00' }],
      prescriber: 'Dr. Nguyen',
      pharmacy: 'Walgreens Land Park',
      // Refill in 5 days — triggers HeadsUp warm card.
      refill_by: dateOnly(daysFromNow(5)),
      pills_left: 4,
      notes: 'Watch for dry cough — call Dr. Nguyen if persistent.',
      started_at: dateOnly(daysAgo(180)),
      created_at: daysAgo(180),
    },
    {
      id: MED_DONEPEZIL,
      parent_id: DEMO_PARENT_ID,
      family_id: DEMO_FAMILY_ID,
      name: 'Donepezil',
      dose: '5 mg tablet',
      purpose: 'Memory (MCI)',
      schedule: [{ time: '20:00' }],
      prescriber: 'Dr. Nguyen',
      pharmacy: 'Walgreens Land Park',
      refill_by: dateOnly(daysFromNow(50)),
      pills_left: 24,
      notes: 'Started after MCI diagnosis. Watch for GI upset, insomnia, dizziness.',
      // Recent start — HeadsUp "possible side effect?" detective links symptoms to it.
      started_at: dateOnly(daysAgo(12)),
      created_at: daysAgo(12),
    },
    {
      id: MED_VITD,
      parent_id: DEMO_PARENT_ID,
      family_id: DEMO_FAMILY_ID,
      name: 'Vitamin D3',
      dose: '2000 IU',
      purpose: 'Supplement',
      schedule: [{ time: '08:00' }],
      prescriber: null,
      pharmacy: null,
      refill_by: null,
      pills_left: 60,
      notes: null,
      started_at: dateOnly(daysAgo(60)),
      created_at: daysAgo(60),
    },
  ];

  // ---- Generate 60 days of dose history for each med -----------------------
  const med_doses: Record<string, unknown>[] = [];
  for (const med of medications) {
    const startedDaysAgo = Math.floor(
      (Date.now() - new Date(med.started_at as string).getTime()) / 86400000,
    );
    // 21 days, not 60. The Timeline still reads as a full history, and it cuts
    // the demo's seed from ~380 rows to ~140 — the difference between the web
    // demo being usable on arrival and looking empty while it loads.
    const historyDays = Math.min(startedDaysAgo, 21);
    for (let dayOffset = historyDays; dayOffset >= -3; dayOffset--) {
      med.schedule.forEach((slot, slotIdx) => {
        const [hh, mm] = slot.time.split(':').map((n) => parseInt(n, 10));
        const scheduled =
          dayOffset >= 0
            ? daysAgo(dayOffset, hh, mm)
            : daysFromNow(-dayOffset, hh, mm);
        const scheduledMs = new Date(scheduled).getTime();
        const isFuture = scheduledMs > Date.now();

        // For past doses, mark ~95% given by a caregiver.
        let given_at: string | null = null;
        let given_by_member_id: string | null = null;
        if (!isFuture) {
          // Deterministic "skip" pattern so it's stable across renders.
          const shouldSkip = (dayOffset * 7 + slotIdx * 3) % 20 === 0;
          if (!shouldSkip) {
            const giverId = pickCaregiver(dayOffset, slotIdx);
            given_by_member_id = giverId;
            // Given time = scheduled + 0-15 min drift.
            const drift = ((dayOffset + slotIdx) % 15) * 60_000;
            given_at = new Date(scheduledMs + drift).toISOString();
          }
        }

        med_doses.push({
          id: nextId('dose'),
          medication_id: med.id,
          family_id: DEMO_FAMILY_ID,
          parent_id: DEMO_PARENT_ID,
          scheduled_at: scheduled,
          given_at,
          given_by_member_id,
          skipped: false,
        });
      });
    }
  }

  const appointments = [
    {
      id: APPT_PAST,
      parent_id: DEMO_PARENT_ID,
      family_id: DEMO_FAMILY_ID,
      provider_name: 'Dr. Rachel Nguyen',
      specialty: 'Primary Care',
      location: 'Kaiser Sacramento Medical Center',
      starts_at: daysAgo(21, 10, 30),
      duration_min: 45,
      status: 'completed',
      summary:
        'MoCA score 22/30 — mild cognitive impairment confirmed. Started Donepezil 5mg evening. A1c 6.9 (down from 7.4). BP 132/84 — Lisinopril holding. Recheck labs in 6 weeks; BP check in 4 weeks.',
      prep_notes:
        'Ask about the memory concerns (misplacing keys 3x this week). Mention the evening confusion after dinner. Bring med list.',
      created_at: daysAgo(60),
    },
    {
      id: APPT_UPCOMING,
      parent_id: DEMO_PARENT_ID,
      family_id: DEMO_FAMILY_ID,
      provider_name: 'Dr. Aditya Kapoor',
      specialty: 'Neurology',
      location: 'UC Davis Health, Sacramento',
      starts_at: daysFromNow(6, 10, 30),
      duration_min: 60,
      status: 'upcoming',
      summary: null,
      prep_notes:
        'Bring symptom log — 4 dizziness episodes in evenings since Donepezil started. Ask: is dizziness typical? Any interaction with Lisinopril? Any concerns with driving? What if she skips a dose?',
      created_at: daysAgo(14),
    },
  ];

  const visit_notes = [
    {
      id: nextId('vn'),
      appointment_id: APPT_PAST,
      family_id: DEMO_FAMILY_ID,
      kind: 'diagnosis',
      body: 'Mild Cognitive Impairment confirmed via MoCA (22/30). Not dementia — but progression risk.',
      captured_at: daysAgo(21, 10, 42),
    },
    {
      id: nextId('vn'),
      appointment_id: APPT_PAST,
      family_id: DEMO_FAMILY_ID,
      kind: 'new-med',
      body: 'Donepezil 5mg once daily in the evening. Reduces cognitive decline in some MCI patients. Watch: GI upset, insomnia, dizziness, muscle cramps.',
      captured_at: daysAgo(21, 10, 44),
    },
    {
      id: nextId('vn'),
      appointment_id: APPT_PAST,
      family_id: DEMO_FAMILY_ID,
      kind: 'instruction',
      body: 'Continue Metformin & Lisinopril unchanged. Add Vitamin D3 (2000 IU daily). Aim for 30 min walk 5x/week.',
      captured_at: daysAgo(21, 10, 51),
    },
    {
      id: nextId('vn'),
      appointment_id: APPT_PAST,
      family_id: DEMO_FAMILY_ID,
      kind: 'follow-up',
      body: 'A1c + basic metabolic panel in 6 weeks. BP recheck in 4 weeks. Neurology consult scheduled with Dr. Kapoor.',
      captured_at: daysAgo(21, 10, 55),
    },
    {
      id: nextId('vn'),
      appointment_id: APPT_PAST,
      family_id: DEMO_FAMILY_ID,
      kind: 'voice',
      body: '"Dr. Nguyen mentioned that if driving becomes concerning, an occupational therapist can do an on-road evaluation. Number in the office packet."',
      captured_at: daysAgo(21, 11, 3),
    },
  ];

  const symptoms = [
    // 4 dizziness episodes, all evening, all post-Donepezil start (12 days ago).
    // HeadsUp detective flags these as possible Donepezil side effect.
    {
      id: nextId('sym'),
      parent_id: DEMO_PARENT_ID,
      family_id: DEMO_FAMILY_ID,
      description: 'Dizziness after dinner — had to sit down for 10 min',
      severity: 'moderate',
      observed_at: daysAgo(11, 20, 45),
      observed_by_member_id: SOFIA_ID,
      possible_med_links: [MED_DONEPEZIL],
    },
    {
      id: nextId('sym'),
      parent_id: DEMO_PARENT_ID,
      family_id: DEMO_FAMILY_ID,
      description: 'Dizzy walking to bathroom around 9pm',
      severity: 'mild',
      observed_at: daysAgo(8, 21, 10),
      observed_by_member_id: MARCUS_ID,
      possible_med_links: [MED_DONEPEZIL],
    },
    {
      id: nextId('sym'),
      parent_id: DEMO_PARENT_ID,
      family_id: DEMO_FAMILY_ID,
      description: 'Mild nausea, no vomiting',
      severity: 'mild',
      observed_at: daysAgo(5, 14, 20),
      observed_by_member_id: SOFIA_ID,
      possible_med_links: null,
    },
    {
      id: nextId('sym'),
      parent_id: DEMO_PARENT_ID,
      family_id: DEMO_FAMILY_ID,
      description: 'Dizziness after evening pill — held onto counter',
      severity: 'moderate',
      observed_at: daysAgo(6, 20, 30),
      observed_by_member_id: SOFIA_ID,
      possible_med_links: [MED_DONEPEZIL],
    },
    {
      id: nextId('sym'),
      parent_id: DEMO_PARENT_ID,
      family_id: DEMO_FAMILY_ID,
      description: 'Feeling tired mid-afternoon, took a nap',
      severity: 'mild',
      observed_at: daysAgo(2, 15, 0),
      observed_by_member_id: PRIYA_ID,
      possible_med_links: null,
    },
    {
      id: nextId('sym'),
      parent_id: DEMO_PARENT_ID,
      family_id: DEMO_FAMILY_ID,
      description: 'Dizzy for a moment after standing from couch, 8:45pm',
      severity: 'mild',
      observed_at: daysAgo(3, 20, 45),
      observed_by_member_id: SOFIA_ID,
      possible_med_links: [MED_DONEPEZIL],
    },
  ];

  const handoffs = [
    // Completed handoff earlier today — Marcus → Sofia at 9am.
    {
      id: nextId('ho'),
      parent_id: DEMO_PARENT_ID,
      family_id: DEMO_FAMILY_ID,
      from_member_id: MARCUS_ID,
      to_member_id: SOFIA_ID,
      summary:
        'Gave both morning meds (Metformin + Lisinopril + Vit D). BP 128/82. Ate a full breakfast — oatmeal + banana. Mood good, chatty. Bathroom trips normal.',
      personal_message:
        'She was asking about the grandkids — send her a photo when you get a sec. ❤️',
      sent_at: daysAgo(0, 9, 0),
      accepted_at: daysAgo(0, 9, 4),
      until: daysFromNow(0, 21, 0),
    },
    // Pending handoff from Priya — 1 hour ago. HeadsUp shows this with Accept.
    {
      id: nextId('ho'),
      parent_id: DEMO_PARENT_ID,
      family_id: DEMO_FAMILY_ID,
      from_member_id: PRIYA_ID,
      to_member_id: SOFIA_ID,
      summary:
        'Called Mom to check in — says she\'s tired but ok. Reminded her about the tonight Donepezil. She mentioned the neurology appt on Tuesday — a little anxious about it.',
      personal_message:
        'Might be worth walking her through the prep questions this weekend.',
      sent_at: (() => {
        const d = new Date();
        d.setHours(d.getHours() - 1, 0, 0, 0);
        return d.toISOString();
      })(),
      accepted_at: null,
      until: daysFromNow(1, 9, 0),
    },
    // Older handoff, 3 days ago — Sofia → Marcus.
    {
      id: nextId('ho'),
      parent_id: DEMO_PARENT_ID,
      family_id: DEMO_FAMILY_ID,
      from_member_id: SOFIA_ID,
      to_member_id: MARCUS_ID,
      summary:
        'Heading to a conference for 2 days. Meds & appointments logged in Halmoni. She has a book club at 2pm Saturday if she wants to go — Kathy will drive.',
      personal_message: 'Call me anytime, even 3am. Love you.',
      sent_at: daysAgo(3, 18, 0),
      accepted_at: daysAgo(3, 18, 12),
      until: daysAgo(1, 9, 0),
    },
  ];

  const on_duty = [
    {
      parent_id: DEMO_PARENT_ID,
      family_id: DEMO_FAMILY_ID,
      member_id: SOFIA_ID,
      until: daysFromNow(0, 21, 0),
    },
  ];

  const thread_messages = [
    {
      id: nextId('msg'),
      parent_id: DEMO_PARENT_ID,
      family_id: DEMO_FAMILY_ID,
      author_member_id: MARCUS_ID,
      body: 'Just called Mom — she sounded good. BP was 128/82 this morning.',
      is_digest: false,
      created_at: daysAgo(2, 10, 15),
    },
    {
      id: nextId('msg'),
      parent_id: DEMO_PARENT_ID,
      family_id: DEMO_FAMILY_ID,
      author_member_id: SOFIA_ID,
      body: 'Amazing. Did she remember the evening Donepezil last night? I saw a symptom log come in around 8:45.',
      is_digest: false,
      created_at: daysAgo(2, 11, 2),
    },
    {
      id: nextId('msg'),
      parent_id: DEMO_PARENT_ID,
      family_id: DEMO_FAMILY_ID,
      author_member_id: MARCUS_ID,
      body: 'Yes she did — but she said she got dizzy again. That\'s 4 times now, all after the evening pill. Worth flagging for Dr. Kapoor next week?',
      is_digest: false,
      created_at: daysAgo(2, 11, 8),
    },
    {
      id: nextId('msg'),
      parent_id: DEMO_PARENT_ID,
      family_id: DEMO_FAMILY_ID,
      author_member_id: PRIYA_ID,
      body: 'I put the pattern in the prep notes for Tuesday. Also her refill for Lisinopril is coming up — someone want to grab it?',
      is_digest: false,
      created_at: daysAgo(1, 19, 30),
    },
    {
      id: nextId('msg'),
      parent_id: DEMO_PARENT_ID,
      family_id: DEMO_FAMILY_ID,
      author_member_id: SOFIA_ID,
      body: 'I\'ve got the refill. Passing through Walgreens tomorrow.',
      is_digest: false,
      created_at: daysAgo(1, 19, 45),
    },
    {
      id: nextId('msg'),
      parent_id: DEMO_PARENT_ID,
      family_id: DEMO_FAMILY_ID,
      author_member_id: MARCUS_ID,
      body: 'Thanks Sof. Taking her to the neurologist Tuesday — I can drive up from Portland Monday night.',
      is_digest: false,
      created_at: daysAgo(1, 20, 10),
    },
  ];

  const notes: Record<string, unknown>[] = [
    {
      id: nextId('note'),
      parent_id: DEMO_PARENT_ID,
      family_id: DEMO_FAMILY_ID,
      author_member_id: SOFIA_ID,
      kind: 'mood',
      body: 'Mom was in good spirits today — asked to call her old college roommate. Long chat, a lot of laughing. First time in weeks she brought up someone by name unprompted.',
      created_at: daysAgo(2, 20, 15),
    },
    {
      id: nextId('note'),
      parent_id: DEMO_PARENT_ID,
      family_id: DEMO_FAMILY_ID,
      author_member_id: MARCUS_ID,
      kind: 'observation',
      body: 'She skipped her afternoon walk two days in a row. Not tired — said her knee ached on the stairs. Worth mentioning at neurology, but also maybe orthopedics soon.',
      created_at: daysAgo(4, 18, 40),
    },
    {
      id: nextId('note'),
      parent_id: DEMO_PARENT_ID,
      family_id: DEMO_FAMILY_ID,
      author_member_id: PRIYA_ID,
      kind: 'mood',
      body: 'Video call went great. She recognized me right away and asked about the kids. Repeated the same question about school twice but seemed happy.',
      created_at: daysAgo(6, 11, 30),
    },
  ];

  return {
    families,
    family_members,
    parents,
    medications,
    med_doses,
    appointments,
    visit_notes,
    symptoms,
    handoffs,
    on_duty,
    thread_messages,
    notes,
  };
}

export function newDemoId(prefix = 'demo') {
  return nextId(prefix);
}
