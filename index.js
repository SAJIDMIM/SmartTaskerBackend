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

// Nodemailer setup with TLS fix
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  tls: {
    rejectUnauthorized: false, // For dev only
  },
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
      <p><strong>Due Date:</strong> ${new Date(
        task.dueDate
      ).toLocaleDateString()}</p>
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

// Middleware
app.use(
  cors({
    origin: "https://tubular-pasca-920451.netlify.app/",
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  })
);
app.use(express.json());

// MongoDB connection (without deprecated options)
mongoose
  .connect(MONGO_URI)
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
    priority: {
      type: String,
      enum: ["High", "Medium", "Low"],
      default: "Medium",
    },
    category: { type: String, default: "General" },
    dueDate: { type: Date, required: true },
    recurrence: {
      type: String,
      enum: ["None", "Daily", "Weekly", "Monthly"],
      default: "None",
    },
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

// === FIX: Root route to avoid "Cannot GET /" ===
app.get("/", (req, res) => {
  res.send("SmartTasker Backend API is running!");
});

// Routes

// Signup
app.post("/api/signup", async (req, res) => {
  const { email, password } = req.body || {};
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
    console.error("Signup error:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

// Login
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password)
    return res.status(400).json({ message: "Email and password required" });

  try {
    const user = await User.findOne({ email });
    if (!user)
      return res.status(401).json({ message: "Invalid email or password" });

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch)
      return res.status(401).json({ message: "Invalid email or password" });

    return res
      .status(200)
      .json({ message: "Login successful", email: user.email });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

// Get all tasks
app.get("/api/tasks", async (req, res) => {
  try {
    const tasks = await Task.find().sort({ dueDate: 1 });
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get tasks by date
app.get("/api/tasks/date/:date", async (req, res) => {
  try {
    const start = new Date(req.params.date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const tasks = await Task.find({
      dueDate: { $gte: start, $lt: end },
    }).sort({ dueDate: 1 });

    res.json(tasks);
  } catch (err) {
    console.error("Get tasks by date error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Dashboard summary
app.get("/api/dashboard-summary", async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    const scheduledTasks = await Task.find().sort({ dueDate: 1 });
    const deadlineReminders = await Task.find({
      dueDate: { $gte: today, $lt: tomorrow },
    });
    const recurringTasks = await Task.find({ recurrence: { $ne: "None" } });
    const highPriorityTasks = await Task.find({ priority: "High" });

    res.json({
      scheduledTasks,
      deadlineReminders,
      recurringTasks,
      highPriorityTasks,
    });
  } catch (err) {
    console.error("Dashboard summary error:", err);
    res.status(500).json({ message: "Failed to fetch dashboard summary" });
  }
});

// Create task
app.post("/api/tasks", async (req, res) => {
  try {
    const {
      title,
      priority,
      category,
      dueDate,
      recurrence = "None",
    } = req.body;

    const newTask = new Task({
      title,
      priority,
      category,
      dueDate: new Date(dueDate),
      recurrence,
    });

    const savedTask = await newTask.save();
    broadcastTaskUpdate("TASK_ADDED", savedTask);

    if (recurrence !== "None") {
      await sendRecurringTaskEmail(savedTask);
    }

    res.status(201).json(savedTask);
  } catch (err) {
    console.error("Error saving task:", err);
    res.status(400).json({ message: err.message });
  }
});

// Update task
app.put("/api/tasks/:id", async (req, res) => {
  try {
    const updatedTask = await Task.findByIdAndUpdate(
      req.params.id,
      { ...req.body, dueDate: new Date(req.body.dueDate) },
      { new: true }
    );

    if (!updatedTask)
      return res.status(404).json({ message: "Task not found" });

    broadcastTaskUpdate("TASK_UPDATED", updatedTask);
    res.json(updatedTask);
  } catch (err) {
    console.error("Update task error:", err);
    res.status(400).json({ message: err.message });
  }
});

// Delete task
app.delete("/api/tasks/:id", async (req, res) => {
  try {
    const deletedTask = await Task.findByIdAndDelete(req.params.id);
    if (!deletedTask)
      return res.status(404).json({ message: "Task not found" });

    broadcastTaskUpdate("TASK_DELETED", deletedTask);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
