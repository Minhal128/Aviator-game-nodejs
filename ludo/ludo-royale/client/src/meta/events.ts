/**
 * Home events row (Ludo-World teardown "botonera de eventos"): four round
 * candy buttons under the HUD — Lucky Wheel (spins badge), Daily Bonus,
 * Invite and Feedback. Wheel/calendar art is procedural CSS (conic-gradient
 * wheel, cream calendar tile); gift/chat ride the filled SVG set. Feedback
 * opens a mailto: placeholder — lr_settings has `support_feedback_url` but
 * no public settings endpoint yet (documented v1.1 wiring).
 */
import { t } from '../i18n';
import { svgIcon } from './icons';
import { metaState, on } from './store';
import { button, el } from './ui';

/** v1 placeholder until /api/config exposes support_feedback_url (v1.1). */
const FEEDBACK_MAILTO = 'mailto:support@example.com?subject=Ludo%20Royale%20Feedback';

export interface EventsHandlers {
  openWheel: () => void;
  openDaily: () => void;
  openInvite: () => void;
}

export interface EventsHandle {
  root: HTMLElement;
  dispose: () => void;
}

export function buildEventsRow(handlers: EventsHandlers): EventsHandle {
  const root = el('div', 'lr-events');

  // -- Lucky Wheel with spins badge ------------------------------------------
  const wheelBtn = button('lr-event', '', handlers.openWheel);
  const wheelArt = el('span', 'lr-event__art lr-event__art--wheel');
  wheelArt.append(el('span', 'lr-event__wheel-hub'));
  const wheelBadge = el('span', 'lr-badge lr-badge--hidden');
  wheelBtn.append(wheelArt, wheelBadge, el('span', 'lr-event__label', t('events.wheel')));

  // -- Daily Bonus ------------------------------------------------------------
  const dailyBtn = button('lr-event', '', handlers.openDaily);
  const dailyArt = el('span', 'lr-event__art lr-event__art--daily');
  dailyArt.append(svgIcon('calendar', 'lr-icon lr-event__glyph'));
  dailyBtn.append(dailyArt, el('span', 'lr-event__label', t('events.daily')));

  // -- Invite ------------------------------------------------------------------
  const inviteBtn = button('lr-event', '', handlers.openInvite);
  const inviteArt = el('span', 'lr-event__art lr-event__art--invite');
  inviteArt.append(svgIcon('gift', 'lr-icon lr-event__glyph'));
  inviteBtn.append(inviteArt, el('span', 'lr-event__label', t('events.invite')));

  // -- Feedback ----------------------------------------------------------------
  const feedbackBtn = button('lr-event', '', () => {
    window.location.href = FEEDBACK_MAILTO;
  });
  const feedbackArt = el('span', 'lr-event__art lr-event__art--feedback');
  feedbackArt.append(svgIcon('chat', 'lr-icon lr-event__glyph'));
  feedbackBtn.append(feedbackArt, el('span', 'lr-event__label', t('events.feedback')));

  root.append(wheelBtn, dailyBtn, inviteBtn, feedbackBtn);

  const renderWheel = (): void => {
    const spins = metaState.wheelSpins;
    const show = spins !== null && spins > 0;
    wheelBadge.classList.toggle('lr-badge--hidden', !show);
    if (show) wheelBadge.textContent = String(spins);
  };
  renderWheel();
  const offWheel = on('wheel', renderWheel);

  return {
    root,
    dispose: () => {
      offWheel();
      root.remove();
    },
  };
}
