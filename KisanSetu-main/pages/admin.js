export const access = 'admin';
export const methods = ['GET'];

export default async function (req, res) {
  res.setHeader('Content-Type','text/html; charset=utf-8');
  return res.send('<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#173e2b"><title>KisanSetu Admin — Operations</title><link rel="stylesheet" href="/theme.css"><script src="/vendor/react.js"></script><script src="/vendor/react-dom.js"></script><script src="/vendor/htm.js"></script><script src="/__hatchable/events.js"></script></head><body class="admin-body"><div id="admin-root"><div class="boot-screen"><span class="brand-mark">K</span><p>Loading secure operations console…</p></div></div><script src="/admin-app.js"></script></body></html>');
}