const functions = require("firebase-functions");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");

admin.initializeApp();

// Configure your Gmail SMTP Transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "JivaSteps@gmail.com ", // Your Gmail
    pass: "wtdgiaexyfebxebp", // The 16-char App Password
  },
});

// Listen for new documents in 'mail_queue' collection
exports.sendInviteEmail = functions.firestore
  .document("mail_queue/{docId}")
  .onCreate(async (snap, context) => {
    const data = snap.data();

    const mailOptions = {
      from: '"ExpenseFlow Pro" <your-email@gmail.com>',
      to: data.to_email,
      subject: "Join my Household on ExpenseFlow",
      html: `
        <h3>Hello ${data.to_name},</h3>
        <p>${data.from_name} has invited you to join their shared household on ExpenseFlow Pro.</p>
        <p>Click the link below to accept:</p>
        <a href="${data.invite_link}" style="padding: 10px 20px; background-color: #2563eb; color: white; text-decoration: none; border-radius: 5px;">Accept Invite</a>
        <p><small>Or copy this link: ${data.invite_link}</small></p>
      `,
    };

    try {
      await transporter.sendMail(mailOptions);
      // Mark as sent
      return snap.ref.set({ status: "sent", sentAt: admin.firestore.Timestamp.now() }, { merge: true });
    } catch (error) {
      console.error("Error sending email:", error);
      return snap.ref.set({ status: "error", error: error.toString() }, { merge: true });
    }
  });