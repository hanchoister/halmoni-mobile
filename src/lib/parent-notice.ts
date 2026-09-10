/**
 * The one-page notice for the parent (G1-28).
 *
 * The attestation on its own answers Apple and gives Washington a consent
 * record, but "I have their permission" is only true if they were actually told
 * something. This is that something: a single sheet, in plain language, in a
 * size someone in their seventies can read, that says what is being kept, who
 * can see it, and how to make it stop.
 *
 * Printed rather than in-app on purpose. The parent does not have the app, does
 * not have an account, and in the case this exists for may not use a smartphone
 * at all.
 */
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { CONSENT_BASIS_COPY, CONSENT_NOTICE_VERSION, NOTICE_ARCHIVE } from '@/lib/consent';
import type { ConsentBasis } from '@/lib/consent';

export type NoticeDetails = {
  /** What the family calls them, or their full name. */
  parentName: string;
  basis: ConsentBasis;
  /** The person who attested — the parent's contact for questions. */
  contactName?: string | null;
  /** Which version's wording to print. Defaults to the current one. */
  version?: string;
};

function esc(s: string | null | undefined): string {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildNoticeHtml(d: NoticeDetails): string {
  const version = d.version ?? CONSENT_NOTICE_VERSION;
  const notice = NOTICE_ARCHIVE[version] ?? NOTICE_ARCHIVE[CONSENT_NOTICE_VERSION];
  const who = d.contactName?.trim();
  const basisLine = CONSENT_BASIS_COPY[d.basis].noticeLine;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  /* 13pt body, not 11 — the reader is the person this is about, and half of
     them have their phone set to large text for a reason. */
  @page { margin: 18mm 16mm; }
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #1e1c1a; font-size: 13pt; line-height: 1.55; }
  h1 { font-size: 19pt; line-height: 1.25; margin: 0 0 4mm; }
  .for { font-size: 12pt; color: #6b6259; margin: 0 0 8mm; }
  p { margin: 0 0 4.5mm; }
  .basis { background: #f5f0e7; border-left: 3px solid #56766a; padding: 4mm 5mm; margin: 0 0 6mm; }
  .stop { border: 1px solid #ddd1c0; border-radius: 3mm; padding: 5mm; margin-top: 6mm; }
  .stop h2 { font-size: 13pt; margin: 0 0 2mm; }
  .foot { margin-top: 9mm; font-size: 9.5pt; color: #8a8078; border-top: 1px solid #ede4d6; padding-top: 3mm; display: flex; justify-content: space-between; }
</style>
</head>
<body>
  <h1>${esc(notice.heading)}</h1>
  <p class="for">For ${esc(d.parentName)}</p>

  <div class="basis">
    <strong>${esc(who ? `${who} set this up.` : 'A family member set this up.')}</strong>
    ${esc(basisLine)}
  </div>

  ${notice.paragraphs.map((t) => `<p>${esc(t)}</p>`).join('\n  ')}

  <div class="stop">
    <h2>If you want it stopped</h2>
    <p style="margin:0">Say so to ${esc(who || 'the family member who set this up')}. They can delete your record from the app, and it is removed everywhere — including from the other phones in your family. You do not have to give a reason.</p>
  </div>

  <div class="foot">
    <div>halmoni.app · privacy@halmoni.app</div>
    <div>Notice version ${esc(version)}</div>
  </div>
</body>
</html>`;
}

/** Renders the notice to a PDF and opens the share sheet (print, mail, save). */
export async function shareParentNotice(d: NoticeDetails): Promise<void> {
  const html = buildNoticeHtml(d);
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      dialogTitle: `Notice for ${d.parentName}`,
      UTI: 'com.adobe.pdf',
    });
  }
}
