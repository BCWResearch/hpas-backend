import nodemailer from "nodemailer";

// 1. Create a transporter (use your SMTP provider credentials)
const transporter = nodemailer.createTransport({
  service: "gmail", // or "SendGrid", "Outlook", etc.
  auth: {
    user: process.env.EMAIL_USER, // your email
    pass: process.env.EMAIL_PASS, // your app password (not raw Gmail password)
  },
});

// 2. Function to send mail
export async function sendEmail(to: string[] | string, subject: string, html: string) {
  const info = await transporter.sendMail({
    from: `"Hashport Faucet" <${process.env.EMAIL_USER}>`,
    to: Array.isArray(to) ? to.join(", ") : to,
    subject,
    html,
  });
  console.log("Email sent: ", info.messageId);
  return;
}

