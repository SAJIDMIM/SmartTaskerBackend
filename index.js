require("dotenv").config();
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const cors = require("cors");
const nodemailer = require("nodemailer");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  tls: { rejectUnauthorized: false },
});

// Email helper
const sendRecurringTaskEmail = async (task) => {
  const mailOptions = {
    from: `"SmartTasker" <${process.env.EMAIL_USER}>`,
    to: process.env.EMAIL_USER,
    subject: `Recurring Task Added: ${task.title}`,
    html: `
      <h3>New Recurring Task Created</h3>
      <p><strong>Title:</strong> ${task.title}</p>
      <p><strong>Due Date:</strong> ${new Date(task.dueDate).toLocaleDateString()}</p>
      <p><strong>Priority:</strong> ${task.priority}</p>
      <p><strong>Category:</strong> ${task.category}</p>
      <p><strong>Recurrence:</strong> ${task.recurrence}</p>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`📧 Email sent for recurring task: ${task.title}`);
  } catch (err) {
    console.error("Failed to send email:", err);
  }
};

// === CORS Configuration ===
app.use(
  cors({
    origin: "https://smart-tasker-frontend-dlpo.vercel.app",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  })
);
app.options("*", cors());
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "https://smart-tasker-frontend-dlpo.vercel.app");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  next();
});

app.use(express.json());

// MongoDB connection
mongoose.connect(MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

// Schemas
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
});
const User = mongoose.model("Users", userSchema);

const taskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    priority: { type: String, enum: ["High", "Medium", "Low"], default: "Medium" },
    category: { type: String, default: "General" },
    dueDate: { type: Date, required: true },
    recurrence: { type: String, enum: ["None", "Daily", "Weekly", "Monthly"], default: "None" },
  },
  { timestamps: true }
);
const Task = mongoose.model("Tasks", taskSchema);

// WebSocket
wss.on("connection", (ws) => {
  console.log("WebSocket client connected");
  ws.on("close", () => console.log("WebSocket client disconnected"));
});
const broadcastTaskUpdate = (type, task) => {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type, task }));
    }
  });
};

// Routes
app.get("/", (req, res) => res.send("SmartTasker Backend API is running!"));

app.post("/api/signup", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ message: "Email and password required" });

  try {
    const existingUser = await User.findOne({ email });
    if (existingUser)
      return res.status(409).json({ message: "Email already registered" });

    const passwordHash = await bcrypt.hash(password, 10);
    const newUser = new User({ email, passwordHash });
    await newUser.save();
    return res.status(201).json({ message: "User registered successfully" });
  } catch (error) {
    return res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ message: "Email and password required" });

  try {
    const user = await User.findOne({ email });
    if (!user)
      return res.status(401).json({ message: "Invalid email or password" });

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch)
      return res.status(401).json({ message: "Invalid email or password" });

    return res.status(200).json({ message: "Login successful", email: user.email });
  } catch (error) {
    return res.status(500).json({ message: "Server error" });
  }
});

// Task routes...
// (same as previous code, no changes here)

server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
