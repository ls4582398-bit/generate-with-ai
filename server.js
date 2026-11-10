const express = require("express");
const path = require("path");

const app = express();

app.use(express.json({ limit: "2mb" }));
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;

const MODEL = "@cf/black-forest-labs/flux-1-schnell";

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    provider: "Cloudflare Workers AI"
  });
});

app.post("/api/generate-image", async (req, res) => {
  try {
    const prompt = String(
      (req.body && req.body.prompt) || ""
    ).trim();

    if (!prompt) {
      return res.status(400).json({
        error: "Please enter an image prompt."
      });
    }

    const accountId = process.env.CF_ACCOUNT_ID;
    const apiToken = process.env.CF_API_TOKEN;

    if (!accountId || !apiToken) {
      return res.status(500).json({
        error: "Cloudflare API settings are missing."
      });
    }
        const endpoint =
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${MODEL}`;

    const response = await fetch(endpoint, {
      method: "POST",

      headers: {
        "Authorization": `Bearer ${apiToken}`,
        "Content-Type": "application/json"
      },

      body: JSON.stringify({
        prompt: prompt,
        steps: 4
      })
    });

    if (!response.ok) {
      const errorText = await response.text();

      console.error("Cloudflare error:", errorText);

      return res.status(response.status).json({
        error: "Cloudflare image generation failed.",
        details: errorText
      });
    }
        const contentType =
      response.headers.get("content-type") || "";

    let imageData;

    if (contentType.includes("application/json")) {
      const result = await response.json();

      imageData =
        result.result?.image ||
        result.image;
    } else {
      const buffer = Buffer.from(
        await response.arrayBuffer()
      );

      imageData = buffer.toString("base64");
    }

    if (!imageData) {
      return res.status(500).json({
        error: "Image was not returned by Cloudflare."
      });
    }

    const image =
      imageData.startsWith("data:")
        ? imageData
        : `data:image/jpeg;base64,${imageData}`;

    res.json({
      image: image,
      dataURI: image
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Something went wrong."
    });
  }
});

app.listen(PORT, () => {
  console.log(
    `Generate with AI running on port ${PORT}`
  );
});
