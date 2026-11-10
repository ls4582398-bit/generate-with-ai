const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(__dirname));

app.get('/health', (req, res) => {
  res.json({ ok: true, message: 'Server is running' });
});

app.post('/api/generate-image', async (req, res) => {
  try {
    const prompt = typeof req.body.prompt === 'string' ? req.body.prompt.trim() : '';
    const token = process.env.CF_ACCOUNT_ID;

    if (!prompt) {
      return res.status(400).json({ error: 'Please enter a prompt.' });
    }
    if (!token) {
      return res.status(500).json({ error: 'CF_ACCOUNT_ID is missing in Render Environment Variables.' });
    }

    const response = await fetch(
      'https://router.cloudflare.co/hf-inference/models/stabilityai/stable-diffusion-3-medium-diffusers',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          inputs: prompt,
          parameters: { num_inference_steps: 25 }
        })
      }
    );

    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !contentType.startsWith('image/')) {
      const details = await response.text();
      console.error('Cloudflare error:', response.status, details);
      return res.status(response.status || 502).json({
        error: 'Image generation failed. Check the Cloudflare model/provider response.',
        details: details.slice(0, 1200)
      });
    }

    const imageBuffer = Buffer.from(await response.arrayBuffer());
    res.json({ image: `data:${contentType};base64,${imageBuffer.toString('base64')}` });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Server error. Please try again.', details: error.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
