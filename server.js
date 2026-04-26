const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
app.use(cors()); // Allow requests from your browser app
app.use(express.json());

const META_API = "https://graph.facebook.com/v19.0";

// ✅ GET profile
app.get("/profile", async (req, res) => {
  const { token, userId } = req.query;
  try {
    const r = await fetch(`${META_API}/${userId}?fields=id,name,username,biography,followers_count,media_count,profile_picture_url&access_token=${token}`);
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ✅ GET recent media/posts
app.get("/media", async (req, res) => {
  const { token, userId } = req.query;
  try {
    const r = await fetch(`${META_API}/${userId}/media?fields=id,caption,media_type,timestamp,like_count,comments_count,media_url,thumbnail_url&access_token=${token}`);
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ✅ GET insights
app.get("/insights", async (req, res) => {
  const { token, userId } = req.query;
  try {
    const r = await fetch(`${META_API}/${userId}/insights?metric=impressions,reach,profile_views&period=day&access_token=${token}`);
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ✅ POST - Publish image to Instagram
app.post("/publish", async (req, res) => {
  const { token, userId, imageUrl, caption } = req.body;
  try {
    // Step 1: Create media container
    const createRes = await fetch(`${META_API}/${userId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: imageUrl, caption, access_token: token })
    });
    const createData = await createRes.json();
    if (createData.error) return res.status(400).json(createData);

    // Step 2: Publish the container
    const publishRes = await fetch(`${META_API}/${userId}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creation_id: createData.id, access_token: token })
    });
    const publishData = await publishRes.json();
    res.json(publishData);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ✅ POST - Schedule a post (saves to memory, auto-posts at time)
const scheduledPosts = [];
app.post("/schedule", async (req, res) => {
  const { token, userId, imageUrl, caption, scheduleTime } = req.body;
  const post = { token, userId, imageUrl, caption, scheduleTime, id: Date.now() };
  scheduledPosts.push(post);

  // Check every minute if it's time to post
  const interval = setInterval(async () => {
    const now = new Date().toISOString();
    if (now >= scheduleTime) {
      clearInterval(interval);
      try {
        const createRes = await fetch(`${META_API}/${userId}/media`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image_url: imageUrl, caption, access_token: token })
        });
        const createData = await createRes.json();
        if (!createData.error) {
          await fetch(`${META_API}/${userId}/media_publish`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ creation_id: createData.id, access_token: token })
          });
          console.log(`✅ Scheduled post published at ${now}`);
        }
      } catch (e) {
        console.error("Schedule post failed:", e.message);
      }
    }
  }, 60000); // Check every 60 seconds

  res.json({ success: true, message: "Post scheduled!", id: post.id, scheduleTime });
});

// ✅ GET scheduled posts
app.get("/scheduled", (req, res) => {
  res.json(scheduledPosts);
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`✅ Krishna AI Instagram Backend running on http://localhost:${PORT}`);
});
