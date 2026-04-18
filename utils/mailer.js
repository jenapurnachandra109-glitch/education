// utils/mailer.js
// Nodemailer wrapper for verification and password reset emails

const nodemailer = require('nodemailer');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
let missingSmtpWarningShown = false;

// Configure your SMTP settings via environment variables
const transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST   || 'smtp.ethereal.email',
    port:   parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || '',
    },
});

const sendMail = async (to, subject, html) => {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
        if (!missingSmtpWarningShown) {
            console.warn('Mailer disabled: set SMTP_USER and SMTP_PASS to enable emails.');
            missingSmtpWarningShown = true;
        }
        return;
    }

    try {
        await transporter.sendMail({ from: `"EduTrack" <${process.env.SMTP_USER}>`, to, subject, html });
    } catch (err) {
        console.error('Email send error:', err.message);
    }
};

const sendVerificationEmail = (email, name, token) => {
    const link = `${BASE_URL}/verify-email?token=${token}`;
    sendMail(email, 'Verify Your EduTrack Account', `
        <h2>Hello, ${name}!</h2>
        <p>Please verify your email address by clicking the button below:</p>
        <a href="${link}" style="background:#1a1a2e;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;">
            Verify Email
        </a>
        <p>This link expires in 24 hours.</p>
    `);
};

const sendPasswordResetEmail = (email, name, token) => {
    const link = `${BASE_URL}/reset-password?token=${token}`;
    sendMail(email, 'Reset Your EduTrack Password', `
        <h2>Hello, ${name}!</h2>
        <p>Click below to reset your password:</p>
        <a href="${link}" style="background:#e74c3c;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;">
            Reset Password
        </a>
        <p>This link expires in 1 hour. If you didn't request this, ignore this email.</p>
    `);
};

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
