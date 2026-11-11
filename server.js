const express = require("express");
const admin = require("firebase-admin");

const app = express();

app.use(express.json({ limit: "2mb" }));
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;
const MODEL = "@cf/black-forest-labs/flux-1-schnell";
const TRIAL_LIMIT = 2;

// Firebase Admin setup
let db = null;

try {
  const serviceAccount = JSON.parse(
    process.env.FIREBASE_SERVICE_ACCOUNT
  );

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });

  db = admin.firestore();
  console.log("Firebase Admin connected");
} catch (error) {
  console.error("Firebase setup failed:", error.message);
}

// Verify that the request comes from a signed-in Firebase user.
async function verifyUser(req, res, next) {
  try {
    if (!db) {
      return res.status(500).json({
        error: "Firebase is not configured."
      });
    }

    const authHeader = req.headers.authorization || "";

    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Please login first."
      });
    }

    const token = authHeader.slice("Bearer ".length);
    req.user = await admin.auth().verifyIdToken(token);

    return next();
  } catch (error) {
    return res.status(401).json({
      error: "Invalid login. Please login again."
    });
  }
}

// Atomically reserve one of the user's two free image generations.
async function reserveImage(uid) {
  const userRef = db.collection("imageUsage").doc(uid);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(userRef);
    const currentCount = snapshot.exists
      ? Number(snapshot.data().imagesGenerated || 0)
      : 0;

    if (currentCount >= TRIAL_LIMIT) {
      return false;
    }

    transaction.set(
      userRef,
      {
        imagesGenerated: currentCount + 1,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    return true;
  });
}

// Refund the reserved count if image generation fails.
async function refundImage(uid) {
  const userRef = db.collection("imageUsage").doc(uid);

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(userRef);

    if (!snapshot.exists) return;

    const currentCount = Number(
      snapshot.data().imagesGenerated || 0
    );

    transaction.update(userRef, {
      imagesGenerated: Math.max(0, currentCount - 1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  });
}

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    provider: "Cloudflare Workers AI",
    firebase: Boolean(db)
  });
});

// Return the signed-in user's server-side trial usage.
app.get("/api/usage", verifyUser, async (req, res) => {
  try {
    const snapshot = await db
      .collection("imageUsage")
      .doc(req.user.uid)
      .get();

    const used = snapshot.exists
      ? Number(snapshot.data().imagesGenerated || 0)
      : 0;

    return res.json({
      used,
      remaining: Math.max(0, TRIAL_LIMIT - used),
      limit: TRIAL_LIMIT
    });
  } catch (error) {
    console.error("Usage error:", error.message);

    return res.status(500).json({
      error: "Could not check image usage."
    });
  }
});

app.post("/api/generate-image", verifyUser, async (req, res) => {
  const uid = req.user.uid;
  let reserved = false;

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

    reserved = await reserveImage(uid);

    if (!reserved) {
      return res.status(403).json({
        error: "Free trial completed.",
        code: "TRIAL_LIMIT_REACHED",
        limit: TRIAL_LIMIT
      });
    }

    const endpoint =
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${MODEL}`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        prompt,
        steps: 4
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Cloudflare error:", errorText);

      await refundImage(uid);
      reserved = false;

      return res.status(502).json({
        error: "Cloudflare image generation failed."
      });
    }

    const contentType = response.headers.get("content-type") || "";
    let imageData;

    if (contentType.includes("application/json")) {
      const result = await response.json();
      imageData = result.result?.image || result.image;
    } else {
      const buffer = Buffer.from(await response.arrayBuffer());
      imageData = buffer.toString("base64");
    }

    if (!imageData) {
      await refundImage(uid);
      reserved = false;

      return res.status(500).json({
        error: "Image was not returned by Cloudflare."
      });
    }

    const image = imageData.startsWith("data:")
      ? imageData
      : `data:image/jpeg;base64,${imageData}`;

    return res.json({
      image,
      dataURI: image
    });
  } catch (error) {
    console.error("Generation error:", error.message);

    if (reserved) {
      try {
        await refundImage(uid);
      } catch (refundError) {
        console.error("Trial refund failed:", refundError.message);
      }
    }

    return res.status(500).json({
      error: "Something went wrong."
    });
  }
});

app.listen(PORT, () => {
  console.log(`Generate with AI running on port ${PORT}`);
});
