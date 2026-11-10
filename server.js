const express = require("express");

const app = express();

app.use(express.json({ limit: "2mb" }));
app.use(express.static(__dirname));

app.post("/api/generate-image", async (req, res) => {
    try {
        const { prompt } = req.body;

        if (!prompt) {
            return res.status(400).json({
                error: "Please enter a prompt"
            });
        }

        const token = process.env.HF_TOKEN;

        if (!token) {
            return res.status(500).json({
                error: "AI API key is not configured yet"
            });
        }
                const response = await fetch(
            "https://router.huggingface.co/hf-inference/models/stabilityai/stable-diffusion-3-medium-diffusers
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    inputs: prompt
                })
            }
        );

        if (!response.ok) {
            return res.status(500).json({
                error: await response.text()
            });
        }

        const image = Buffer.from(
            await response.arrayBuffer()
        );

        res.set("Content-Type", "image/png");
        res.send(image);
     } catch (error) {
        res.status(500).json({
            error: "Image generation failed"
        });
    }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`AI Server running on port ${PORT}`);
});
