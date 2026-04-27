const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

const META_API = "https://graph.facebook.com/v19.0";
const JWT_SECRET = process.env.JWT_SECRET || "krishna-ai-secret-key";

// ✅ Health check
app.get("/", (req, res) => {
  res.json({ status: "✅ InstaFlow AI Backend is running!", version: "1.0.0" });
});

// ==================== DATABASE ====================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(e => console.error("MongoDB error:", e));

// ==================== SCHEMAS ====================
const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String,
  plan: { type: String, default: "free" },
  igAccounts: [{
    userId: String,
    username: String,
    token: String,
    followers: String,
    connectedAt: Date
  }],
  createdAt: { type: Date, default: Date.now }
});

const postSchema = new mongoose.Schema({
  userId: String,
  igUserId: String,
  caption: String,
  imageUrl: String,
  postType: String,
  scheduleTime: Date,
  status: { type: String, default: "scheduled" },
  igPostId: String,
  reach: String,
  score: Number,
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model("User", userSchema);
const Post = mongoose.model("Post", postSchema);

// ==================== AUTH MIDDLEWARE ====================
const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token provided" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
};

// ==================== AUTH ROUTES ====================

// Register
app.post("/auth/register", async (req, res) => {
  const { name, email, password } = req.body;
  try {
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ error: "Email already exists" });
    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password: hashed });
    const token = jwt.sign({ id: user._id, email }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, user: { id: user._id, name, email, plan: user.plan } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Login
app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: "User not found" });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ error: "Wrong password" });
    const token = jwt.sign({ id: user._id, email }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, user: { id: user._id, name: user.name, email, plan: user.plan } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get current user
app.get("/auth/me", auth, async (req, res) => {
  const user = await User.findById(req.user.id).select("-password");
  res.json(user);
});

// ==================== PLANS ====================
app.get("/plans", (req, res) => {
  res.json([
    { id: "free",    name: "Free",    price: 0,  accounts: 1,  posts: 5,   features: ["1 account", "5 posts/mo", "3 captions/day"] },
    { id: "starter", name: "Starter", price: 9,  accounts: 1,  posts: 30,  features: ["1 account", "30 posts/mo", "Unlimited captions", "Auto-posting"] },
    { id: "pro",     name: "Pro",     price: 19, accounts: 3,  posts: 999, features: ["3 accounts", "Unlimited posts", "All AI features", "Priority support"] },
    { id: "agency",  name: "Agency",  price: 49, accounts: 10, posts: 999, features: ["10 accounts", "Unlimited everything", "White label", "API access"] },
  ]);
});

// ==================== INSTAGRAM ROUTES ====================

// Connect Instagram
app.post("/ig/connect", auth, async (req, res) => {
  const { igUserId, username, token: igToken, followers } = req.body;
  try {
    await User.findByIdAndUpdate(req.user.id, {
      $push: {
        igAccounts: {
          userId: igUserId,
          username,
          token: igToken,
          followers,
          connectedAt: new Date()
        }
      }
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Publish post now
app.post("/ig/publish", auth, async (req, res) => {
  const { igUserId, imageUrl, caption, postType } = req.body;
  try {
    const user = await User.findById(req.user.id);
    const account = user?.igAccounts?.find(a => a.userId === igUserId);
    if (!account) return res.status(404).json({ error: "Instagram account not found. Please connect first." });

    // Create media container
    const createRes = await fetch(`${META_API}/${igUserId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: imageUrl, caption, access_token: account.token })
    });
    const createData = await createRes.json();
    if (createData.error) return res.status(400).json(createData);

    // Publish
    const publishRes = await fetch(`${META_API}/${igUserId}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creation_id: createData.id, access_token: account.token })
    });
    const publishData = await publishRes.json();

    // Save to DB
    await Post.create({
      userId: req.user.id, igUserId, caption, imageUrl,
      postType, status: "posted", igPostId: publishData.id,
      scheduleTime: new Date()
    });

    res.json(publishData);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Schedule a post
app.post("/ig/schedule", auth, async (req, res) => {
  const { igUserId, imageUrl, caption, postType, scheduleTime, score, reach } = req.body;
  try {
    const post = await Post.create({
      userId: req.user.id, igUserId, caption, imageUrl,
      postType, scheduleTime: new Date(scheduleTime),
      status: "scheduled", score, reach
    });
    res.json({ success: true, post });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get all posts
app.get("/ig/posts", auth, async (req, res) => {
  const posts = await Post.find({ userId: req.user.id }).sort({ scheduleTime: 1 });
  res.json(posts);
});

// ==================== AUTO-SCHEDULER ====================
setInterval(async () => {
  try {
    const now = new Date();
    const duePosts = await Post.find({ status: "scheduled", scheduleTime: { $lte: now } });
    for (const post of duePosts) {
      try {
        const user = await User.findById(post.userId);
        const account = user?.igAccounts?.find(a => a.userId === post.igUserId);
        if (!account) continue;

        const createRes = await fetch(`${META_API}/${post.igUserId}/media`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image_url: post.imageUrl, caption: post.caption, access_token: account.token })
        });
        const createData = await createRes.json();
        if (createData.error) { await Post.findByIdAndUpdate(post._id, { status: "failed" }); continue; }

        const publishRes = await fetch(`${META_API}/${post.igUserId}/media_publish`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ creation_id: createData.id, access_token: account.token })
        });
        const publishData = await publishRes.json();
        await Post.findByIdAndUpdate(post._id, { status: "posted", igPostId: publishData.id });
        console.log(`✅ Auto-posted for user ${post.userId}`);
      } catch (e) {
        await Post.findByIdAndUpdate(post._id, { status: "failed" });
      }
    }
  } catch (e) {
    console.error("Scheduler error:", e.message);
  }
}, 60000);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`✅ InstaFlow AI Backend running on port ${PORT}`));
