const express = require('express');
const path = require('path');
const { convert } = require('./converter');

const app = express();

app.use(express.json());

app.post('/api/convert', async (req, res) => {
  try {
    const { url, mode } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    const validModes = ['article', 'full'];
    const convertMode = validModes.includes(mode) ? mode : 'article';

    const result = await convert(url, convertMode);

    const wordCount = result.markdown.split(/\s+/).filter(w => w.length > 0).length;

    res.json({
      title: result.title,
      markdown: result.markdown,
      url: result.url,
      mode: result.mode,
      wordCount
    });
  } catch (err) {
    console.error('Conversion error:', err.message);

    const msg = err.message;
    if (err.message.includes('timed out')) {
      return res.status(504).json({ error: msg });
    }
    if (err.message.includes('could not reach') || err.message.includes('down')) {
      return res.status(502).json({ error: msg });
    }

    res.status(422).json({ error: msg });
  }
});

app.get('/download', async (req, res) => {
  try {
    const { url, mode } = req.query;

    if (!url) {
      return res.status(400).type('html').send(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:2rem;text-align:center">
        <h2>Missing URL</h2><p>Usage: <code>/download?url=https://example.com</code></p>
        <p>Optional: <code>&mode=full</code> for full page, <code>&mode=article</code> for article only (default).</p>
        <p><a href="/">Open Web UI</a></p></body></html>`);
    }

    const convertMode = mode || 'article';
    const result = await convert(url, convertMode);

    const safeName = (result.title || 'page')
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 100) || 'page';

    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.md"`);
    res.setHeader('X-Content-Source', result.url);
    res.setHeader('X-Content-Mode', result.mode);
    res.send(result.markdown);
  } catch (err) {
    console.error('Download error:', err.message);
    const msg = err.message;
    if (err.message.includes('timed out')) return res.status(504).type('text').send(msg);
    if (err.message.includes('could not reach')) return res.status(502).type('text').send(msg);
    res.status(422).type('text').send(msg);
  }
});

app.get('/raw', async (req, res) => {
  try {
    const { url, mode } = req.query;

    if (!url) {
      return res.status(400).type('text').send('Missing URL parameter. Usage: /raw?url=https://example.com');
    }

    const convertMode = mode || 'article';
    const result = await convert(url, convertMode);

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(result.markdown);
  } catch (err) {
    console.error('Raw error:', err.message);
    const msg = err.message;
    if (err.message.includes('timed out')) return res.status(504).type('text').send(msg);
    if (err.message.includes('could not reach')) return res.status(502).type('text').send(msg);
    res.status(422).type('text').send(msg);
  }
});

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
