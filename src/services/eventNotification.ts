import Event from '../models/Event';
import { eventMailbox, sendSiteEmail, siteEmailConfigured } from './siteEmail';

export async function notifyEventRegistration(eventId: string, registrationId: string): Promise<void> {
  for (const kind of ['organiser', 'confirmation'] as const) {
    const status = `${kind}NotificationStatus`, attemptedAt = `${kind}NotificationAttemptedAt`;
    if (!siteEmailConfigured(eventMailbox())) {
      await Event.updateOne({ _id: eventId, registrations: { $elemMatch: { _id: registrationId, [status]: { $in: ['pending', 'failed', 'disabled'] } } } },
        { $set: { [`registrations.$.${status}`]: 'disabled' } });
      continue;
    }
    const event = await Event.findOneAndUpdate({ _id: eventId, registrations: { $elemMatch: {
      _id: registrationId, $or: [
        { [status]: { $in: ['pending', 'failed', 'disabled'] } },
        { [status]: 'sending', [attemptedAt]: { $lt: new Date(Date.now() - 5 * 60_000) } },
      ],
    } } }, { $set: { [`registrations.$.${status}`]: 'sending', [`registrations.$.${attemptedAt}`]: new Date() } }, { new: true }).select('+registrations');
    const record = event?.registrations.find(row => String(row._id) === registrationId);
    if (!event || !record) continue;
    let sent = false;
    try {
      sent = kind === 'organiser'
        ? await sendSiteEmail(eventMailbox(), `Event registration: ${event.title}`, `New event registration\n\nEvent: ${event.title}\nDate: ${event.dateLabel}\nTime: ${event.timeStart} – ${event.timeEnd}\nVenue: ${event.location}\nAddress: ${event.address}\n\nName: ${record.firstName} ${record.lastName}\nEmail: ${record.email}\nPhone: ${record.phone || 'Not supplied'}\nPlaces: ${record.places}\nNotes: ${record.notes || 'None'}\nReference: ${record._id}\n\nView in Admin > Events > Registrations.`, record.email)
        : await sendSiteEmail(record.email, `Your registration: ${event.title}`, `Hello ${record.firstName},\n\nYour ${record.places} place(s) are reserved for ${event.title}.\nDate: ${event.dateLabel}\nTime: ${event.timeStart} – ${event.timeEnd}\nVenue: ${event.location}\nAddress: ${event.address}\nPrice: ${event.price}\nReference: ${record._id}\n\n${event.price.toLowerCase() !== 'free' ? 'This registration does not collect payment. Contact the organiser about the listed event price.\n\n' : ''}For questions or changes, contact ${eventMailbox()}.\n\nAl-Burhaniya International`);
    } catch { console.error('[Events] Email failed; registration remains saved.'); }
    await Event.updateOne({ _id: eventId, 'registrations._id': registrationId }, { $set: { [`registrations.$.${status}`]: sent ? 'sent' : 'failed' } });
  }
}
