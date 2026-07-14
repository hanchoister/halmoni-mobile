import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { formatDate } from '@/lib/format';
import type { ParentRow } from '@/lib/parent';
import { supabase } from '@/lib/supabase';

type MedForKit = {
  id: string;
  name: string;
  dose: string | null;
  purpose: string | null;
  schedule: { time: string; withFood?: boolean }[];
};

function esc(s: string | null | undefined): string {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function calcAge(dob: string | null): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age;
}

function scheduleText(sched: MedForKit['schedule']): string {
  if (!sched || sched.length === 0) return '';
  return sched
    .map((s) => `${s.time}${s.withFood ? ' (with food)' : ''}`)
    .join(' · ');
}

function buildHtml(parent: ParentRow, meds: MedForKit[]): string {
  const age = calcAge(parent.dob);
  const label = parent.nickname?.trim() || parent.name;
  const generatedAt = formatDate(new Date().toISOString());

  const conditions = parent.conditions.length
    ? parent.conditions.map((c) => `<span class="tag">${esc(c)}</span>`).join('')
    : '<span class="muted">None recorded</span>';

  const allergies = parent.allergies.length
    ? parent.allergies.map((a) => `<span class="tag danger">⚠ ${esc(a)}</span>`).join('')
    : '<span class="ok">No known allergies</span>';

  const medsRows = meds.length
    ? meds
        .map(
          (m) => `
            <tr>
              <td><strong>${esc(m.name)}</strong>${m.dose ? ` <span class="muted">${esc(m.dose)}</span>` : ''}</td>
              <td>${esc(scheduleText(m.schedule))}</td>
              <td class="muted">${esc(m.purpose)}</td>
            </tr>`,
        )
        .join('')
    : '<tr><td colspan="3" class="muted">No medications recorded</td></tr>';

  const ice = parent.ice_contacts.length
    ? parent.ice_contacts
        .map(
          (c) => `
          <div class="row">
            <div><strong>${esc(c.name)}</strong> <span class="muted">${esc(c.relation)}</span></div>
            <div class="mono">${esc(c.phone)}</div>
          </div>`,
        )
        .join('')
    : '<span class="muted">No ICE contacts recorded</span>';

  const doctor = parent.primary_doctor
    ? `<div><strong>${esc(parent.primary_doctor.name)}</strong> · <span class="mono">${esc(parent.primary_doctor.phone)}</span></div>`
    : '<span class="muted">Not recorded</span>';

  const pharmacy = parent.pharmacy
    ? `<div><strong>${esc(parent.pharmacy.name)}</strong> · <span class="mono">${esc(parent.pharmacy.phone)}</span>${
        parent.pharmacy.address ? `<div class="muted">${esc(parent.pharmacy.address)}</div>` : ''
      }</div>`
    : '<span class="muted">Not recorded</span>';

  const insurance = parent.insurance
    ? `<div><strong>${esc(parent.insurance.provider)}</strong>${
        parent.insurance.planName ? ` · ${esc(parent.insurance.planName)}` : ''
      }</div>
       <div>Member ID: <span class="mono">${esc(parent.insurance.memberId)}</span></div>
       ${parent.insurance.groupId ? `<div>Group ID: <span class="mono">${esc(parent.insurance.groupId)}</span></div>` : ''}
       ${parent.insurance.phone ? `<div>Phone: <span class="mono">${esc(parent.insurance.phone)}</span></div>` : ''}`
    : '<span class="muted">Not recorded</span>';

  return `
<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Care Kit — ${esc(label)}</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    color: #2a2a2a;
    margin: 0;
    padding: 32px 40px;
    font-size: 12px;
    line-height: 1.4;
  }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 {
    font-size: 10px;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: #6f6f6f;
    margin: 20px 0 6px;
    border-bottom: 1px solid #e5dfd0;
    padding-bottom: 4px;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    border-bottom: 2px solid #2a2a2a;
    padding-bottom: 8px;
    margin-bottom: 12px;
  }
  .brand { font-size: 10px; color: #6f6f6f; }
  .sub { color: #6f6f6f; font-size: 12px; }
  .tag {
    display: inline-block;
    background: #f0eadd;
    border-radius: 10px;
    padding: 2px 8px;
    font-size: 11px;
    margin: 2px 4px 2px 0;
  }
  .tag.danger {
    background: #f5dfd4;
    color: #7e4736;
    font-weight: 600;
  }
  .ok { color: #3a4f44; font-style: italic; }
  .muted { color: #6f6f6f; }
  .mono { font-family: Menlo, 'Courier New', monospace; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th, td { text-align: left; padding: 4px 8px 4px 0; vertical-align: top; }
  th { font-size: 10px; letter-spacing: 1px; color: #6f6f6f; }
  tr + tr td { border-top: 1px solid #f3ebde; }
  .row {
    display: flex;
    justify-content: space-between;
    padding: 3px 0;
  }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  .footer {
    margin-top: 28px;
    padding-top: 8px;
    border-top: 1px solid #e5dfd0;
    color: #a8a8a8;
    font-size: 10px;
    display: flex;
    justify-content: space-between;
  }
</style>
</head>
<body>
  <div class="header">
    <div>
      <h1>${esc(label)}</h1>
      <div class="sub">
        ${age != null ? `${age} years old` : ''}${parent.blood_type ? ` · Blood type ${esc(parent.blood_type)}` : ''}
      </div>
    </div>
    <div class="brand">Care Kit · Halmoni</div>
  </div>

  <h2>Allergies</h2>
  <div>${allergies}</div>

  <h2>Conditions</h2>
  <div>${conditions}</div>

  <h2>Current medications</h2>
  <table>
    <thead>
      <tr><th>Medication</th><th>Schedule</th><th>Purpose</th></tr>
    </thead>
    <tbody>${medsRows}</tbody>
  </table>

  ${parent.preferences ? `<h2>What to know</h2><div>${esc(parent.preferences)}</div>` : ''}

  <h2>In case of emergency</h2>
  <div>${ice}</div>

  <div class="grid">
    <div>
      <h2>Primary doctor</h2>
      ${doctor}
    </div>
    <div>
      <h2>Pharmacy</h2>
      ${pharmacy}
    </div>
  </div>

  <h2>Insurance</h2>
  <div>${insurance}</div>

  <div class="footer">
    <div>Generated ${esc(generatedAt)}</div>
    <div>halmoni.uk</div>
  </div>
</body>
</html>
`;
}

export async function shareCareKit(parent: ParentRow): Promise<void> {
  const { data: medsData } = await supabase
    .from('medications')
    .select('id,name,dose,purpose,schedule')
    .eq('parent_id', parent.id)
    .order('name', { ascending: true });
  const meds = (medsData as MedForKit[] | null) ?? [];

  const html = buildHtml(parent, meds);
  const { uri } = await Print.printToFileAsync({ html });
  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      dialogTitle: `${parent.nickname || parent.name} — Care Kit`,
      UTI: 'com.adobe.pdf',
    });
  }
}
