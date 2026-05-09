const webpush = require('web-push');

const VAPID_PUBLIC  = process.env.VAPID_PUBLIC;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE;
const FB_PROJECT    = 'popoci-garden';
const FB_API_KEY    = 'AIzaSyBh2t09QW8wy_0HW5GngQyxuT2rgeovclk';
const FS_BASE       = `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents`;

webpush.setVapidDetails('mailto:popocigarden@noreply.com', VAPID_PUBLIC, VAPID_PRIVATE);

function fval(v) {
  if (!v) return null;
  if (v.stringValue  !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue  !== undefined) return Number(v.doubleValue);
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.arrayValue)  return (v.arrayValue.values || []).map(fval);
  if (v.mapValue)    return parseFields(v.mapValue.fields || {});
  return null;
}
function parseFields(fields) {
  const obj = {};
  for (const [k, v] of Object.entries(fields || {})) obj[k] = fval(v);
  return obj;
}
async function getCollection(col) {
  const r = await fetch(`${FS_BASE}/${col}?key=${FB_API_KEY}&pageSize=200`);
  const d = await r.json();
  return (d.documents || []).map(doc => ({ id: doc.name.split('/').pop(), ...parseFields(doc.fields) }));
}

const DAY = 86400000;
const daysSince = d => !d ? 999 : Math.floor((Date.now() - new Date(d)) / DAY);

async function pushToAll(subscriptions, notification, excludeEndpoint) {
  for (const sub of subscriptions) {
    if (excludeEndpoint && sub.endpoint === excludeEndpoint) continue;
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(notification)
      );
    } catch (e) {
      console.log('Push failed:', e.statusCode);
    }
  }
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const subscriptions = await getCollection('subscriptions');

    if (event.httpMethod === 'POST' && event.body) {
      // Called by client when someone waters a plant
      const { title, body, senderEndpoint } = JSON.parse(event.body);
      await pushToAll(subscriptions, { title, body }, senderEndpoint);
    } else {
      // Called by cron at 17:00 — daily reminder
      const plants = await getCollection('plants');
      const toWater = plants.filter(p =>
        p.manualStatus !== 'dead' && (p.freqDays || 7) - daysSince(p.lastWatered) <= 0
      );
      const body = toWater.length === 0
        ? '✅ Nessuna pianta da annaffiare oggi!'
        : `💧 Oggi: ${toWater.map(p => p.name).join(', ')}`;
      await pushToAll(subscriptions, { title: '🌿 Popoci Garden', body });
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    console.error(e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
